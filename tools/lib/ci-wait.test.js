'use strict';
/**
 * #495: one CI-wait primitive. The cost of a wait is asserted here, not estimated: the issue's
 * "done when" is a ship or sweep waiting on a 15-minute run spending under 40 REST calls, and a
 * rate-limit error ending the wait with its own exit code.
 *
 * Unit half: the pure loop over a fake clock. CLI half: the real `colab ci-wait` against a fake
 * `gh` that answers `api -i` with an HTTP head — the shape gh really prints (measured: a 304 exits
 * 1 with the head on stdout and `gh: HTTP 304` on stderr).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const cw = require('./ci-wait');

function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: (ms) => { t += ms; }, at: () => t };
}

const ok = (state, etag = '"e1"') => ({ kind: 'ok', status: 200, etag, state, summary: { status: state === 'pending' ? 'in_progress' : 'completed' } });

test('delayFor: 0 first, then 30 → 60 → 120, and 120 repeats', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map((i) => cw.delayFor(i)), [0, 30, 60, 120, 120, 120]);
});

test('a 15-minute run costs well under 40 calls — the issue\'s done-when', () => {
  const c = clock();
  const start = c.at();
  let calls = 0;
  const res = cw.waitLoop({
    now: c.now, sleep: c.sleep,
    poll: () => { calls++; return ok(c.at() - start >= 15 * 60_000 ? 'green' : 'pending'); },
  });
  assert.strictEqual(res.outcome, 'GREEN');
  assert.ok(calls < 40, `calls=${calls}`);
  assert.ok(calls <= 12, `backoff should land a 15-min run near 10 polls, got ${calls}`);
  assert.strictEqual(res.polls, calls);
});

test('every poll after the first sends the last ETag; a 304 keeps the previous state', () => {
  const c = clock();
  const seen = [];
  let n = 0;
  const res = cw.waitLoop({
    now: c.now, sleep: c.sleep,
    poll: (etag) => {
      seen.push(etag);
      n++;
      if (n === 1) return ok('pending', '"a"');
      if (n < 4) return { kind: 'not-modified', status: 304 };
      return ok('green', '"b"');
    },
  });
  assert.deepStrictEqual(seen, [null, '"a"', '"a"', '"a"']);
  assert.strictEqual(res.outcome, 'GREEN');
  assert.strictEqual(res.notModified, 2);
});

test('a rate limit ENDS the wait on that poll — no retry', () => {
  const c = clock();
  let calls = 0;
  const res = cw.waitLoop({
    now: c.now, sleep: c.sleep,
    poll: () => { calls++; return calls === 1 ? ok('pending') : { kind: 'rate-limited', status: 403, detail: 'API rate limit exceeded' }; },
  });
  assert.strictEqual(res.outcome, 'RATE_LIMITED');
  assert.strictEqual(calls, 2);
  assert.strictEqual(cw.EXIT[res.outcome], 4);
});

test('a read error or an unrecognised state is UNKNOWN, never "keep waiting"', () => {
  const c = clock();
  assert.strictEqual(cw.waitLoop({ now: c.now, sleep: c.sleep, poll: () => ({ kind: 'error', status: 500, detail: 'HTTP 500' }) }).outcome, 'UNKNOWN');
  assert.strictEqual(cw.waitLoop({ now: c.now, sleep: c.sleep, poll: () => ok('unknown') }).outcome, 'UNKNOWN');
  assert.strictEqual(cw.waitLoop({ now: c.now, sleep: c.sleep, poll: () => ({ kind: 'not-modified', status: 304 }) }).outcome, 'UNKNOWN');
});

test('the deadline ends a pending wait as TIMEOUT, with the sleep clipped to it', () => {
  const c = clock();
  const start = c.at();
  const res = cw.waitLoop({ now: c.now, sleep: c.sleep, deadlineSec: 100, poll: () => ok('pending') });
  assert.strictEqual(res.outcome, 'TIMEOUT');
  assert.strictEqual(c.at() - start, 100_000, 'never sleeps past the deadline');
  assert.strictEqual(res.polls, 4); // +0, +30, +90, then one last look after a 10s sleep clipped to the deadline
});

test('red is RED with exit 1', () => {
  const c = clock();
  const res = cw.waitLoop({ now: c.now, sleep: c.sleep, poll: () => ok('red') });
  assert.strictEqual(res.outcome, 'RED');
  assert.strictEqual(cw.EXIT.RED, 1);
});

test('parseHttp + classifyResponse: 200, 304, 403-quota, 429, 403-other, no head', () => {
  const head = (st, extra = '') => `HTTP/2.0 ${st}\r\nEtag: "x"\r\n${extra}\r\n`;
  const c200 = cw.classifyResponse(cw.parseHttp(head('200 OK') + '{"status":"completed"}'));
  assert.strictEqual(c200.kind, 'ok');
  assert.strictEqual(c200.json.status, 'completed');
  assert.strictEqual(c200.etag, '"x"');
  assert.strictEqual(cw.classifyResponse({ ...cw.parseHttp(head('304 Not Modified')), stderr: 'gh: HTTP 304' }).kind, 'not-modified');
  assert.strictEqual(cw.classifyResponse(cw.parseHttp(head('403 Forbidden', 'X-Ratelimit-Remaining: 0\r\nX-Ratelimit-Reset: 1791199282\r\n') + '{}')).kind, 'rate-limited');
  assert.strictEqual(cw.classifyResponse(cw.parseHttp(head('429 Too Many Requests') + '{}')).kind, 'rate-limited');
  assert.strictEqual(cw.classifyResponse(cw.parseHttp(head('403 Forbidden', 'X-Ratelimit-Remaining: 4000\r\n') + '{"message":"Resource not accessible"}')).kind, 'error');
  assert.strictEqual(cw.classifyResponse({ ...cw.parseHttp(''), stderr: 'gh: API rate limit exceeded for user' }).kind, 'rate-limited');
  assert.strictEqual(cw.classifyResponse({ ...cw.parseHttp('[]'), stderr: 'refusing' }).kind, 'error');
});

test('runState: none/queued/in_progress pending; success green; failure/cancelled red', () => {
  assert.strictEqual(cw.runState({ status: 'none' }), 'pending');
  assert.strictEqual(cw.runState({ status: 'queued' }), 'pending');
  assert.strictEqual(cw.runState({ status: 'completed', conclusion: 'success' }), 'green');
  assert.strictEqual(cw.runState({ status: 'completed', conclusion: 'cancelled' }), 'red');
  assert.strictEqual(cw.runState({ status: 'weird' }), 'unknown');
  assert.strictEqual(cw.runState(null), 'unknown');
});

test('parseDuration', () => {
  assert.deepStrictEqual(['45m', '90s', '1h', '120', 'x', ''].map(cw.parseDuration), [2700, 90, 3600, 120, null, null]);
});

test('acquireLock: a live holder refuses a second waiter; a dead holder is taken over', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-wait-lock-'));
  try {
    const a = cw.acquireLock(dir, '123', 111, () => true);
    assert.ok(a.ok);
    const b = cw.acquireLock(dir, '123', 222, () => true);
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.holder, 111);
    const c = cw.acquireLock(dir, '123', 333, () => false);
    assert.ok(c.ok, 'dead holder taken over');
    c.release();
    assert.ok(cw.acquireLock(dir, '123', 444, () => true).ok, 'released lock is free');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- CLI, against a fake gh

const COLAB = path.resolve(__dirname, '..', 'colab');

function fixture(responses) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-wait-'));
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/example.git'], { cwd: work });
  const seq = path.join(root, 'seq');
  const log = path.join(root, 'calls.log');
  fs.writeFileSync(seq, '0');
  responses.forEach((r, i) => {
    fs.writeFileSync(path.join(root, `r${i}.out`), r.out);
    fs.writeFileSync(path.join(root, `r${i}.code`), String(r.code));
  });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    `echo "$*" >> "${log}"`,
    `n=$(cat "${seq}"); echo $((n+1)) > "${seq}"`,
    `f="${root}/r$n"; [ -f "$f.out" ] || f="${root}/r${responses.length - 1}"`,
    'cat "$f.out"; c=$(cat "$f.code"); [ "$c" = 304 ] && echo "gh: HTTP 304" >&2; [ "$c" = 0 ] || exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: path.join(root, 'home') } };
}

const http = (status, body, extra = '') => `HTTP/2.0 ${status}\r\nEtag: "e"\r\n${extra}\r\n${body}`;

test('CLI: run-id green → exit 0, one call, prints the wait', () => {
  const fx = fixture([{ out: http('200 OK', JSON.stringify({ status: 'completed', conclusion: 'success', html_url: 'https://x/run/9' })), code: 0 }]);
  const r = spawnSync('node', [COLAB, 'ci-wait', '9', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.strictEqual(body.outcome, 'GREEN');
  assert.strictEqual(body.polls, 1);
  assert.strictEqual(body.url, 'https://x/run/9');
  assert.match(fs.readFileSync(fx.log, 'utf8'), /^api -i repos\/\{owner\}\/\{repo\}\/actions\/runs\/9$/m);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: a rate limit exits 4, with no retry', () => {
  const fx = fixture([{ out: http('403 Forbidden', '{"message":"API rate limit exceeded"}', 'X-Ratelimit-Remaining: 0\r\n'), code: 1 }]);
  const r = spawnSync('node', [COLAB, 'ci-wait', '9', '--repo', fx.work], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 4, r.stdout + r.stderr);
  assert.match(r.stdout, /^RATE_LIMITED/);
  assert.strictEqual(fs.readFileSync(fx.log, 'utf8').trim().split('\n').length, 1);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: --sha reads every workflow at the sha — one red sibling is RED (exit 1)', () => {
  const sha = 'a'.repeat(40);
  const runs = { workflow_runs: [
    { id: 1, head_sha: sha, status: 'completed', conclusion: 'success', name: 'CI', event: 'push', html_url: 'u1' },
    { id: 2, head_sha: sha, status: 'completed', conclusion: 'failure', name: 'Release', event: 'push', html_url: 'u2' },
  ] };
  const fx = fixture([{ out: http('200 OK', JSON.stringify(runs)), code: 0 }]);
  const r = spawnSync('node', [COLAB, 'ci-wait', '--sha', sha, '--branch', 'main', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).url, 'u2');
  assert.match(fs.readFileSync(fx.log, 'utf8'), /actions\/runs\?head_sha=a{40}&branch=main&per_page=100/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#503 CLI: --sha ends GREEN when the verifying CI is green and a workflow_run release is still running', () => {
  const sha = 'b'.repeat(40);
  const runs = { workflow_runs: [
    { id: 2, head_sha: sha, status: 'in_progress', conclusion: null, name: 'Release (auto)', event: 'workflow_run', html_url: 'u2' },
    { id: 1, head_sha: sha, status: 'completed', conclusion: 'success', name: 'CI', event: 'push', html_url: 'u1' },
  ] };
  const fx = fixture([{ out: http('200 OK', JSON.stringify(runs)), code: 0 }]);
  const r = spawnSync('node', [COLAB, 'ci-wait', '--sha', sha, '--branch', 'main', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.strictEqual(body.outcome, 'GREEN');
  assert.strictEqual(body.polls, 1, 'no wait on the release lane');
  assert.deepStrictEqual(body.setAside.map((x) => x.workflowName), ['Release (auto)']);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: usage errors exit 2', () => {
  const fx = fixture([{ out: '', code: 1 }]);
  for (const args of [[], ['x1'], ['9', '--sha', 'abc'], ['--branch', 'main'], ['9', '--timeout', 'soon']]) {
    const r = spawnSync('node', [COLAB, 'ci-wait', ...args, '--repo', fx.work], { encoding: 'utf8', env: fx.env });
    assert.strictEqual(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
  }
  fs.rmSync(fx.root, { recursive: true, force: true });
});
