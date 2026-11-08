'use strict';
/**
 * A CI step that downloads a pinned binary fails loudly and retries on an upstream error (#690).
 * `curl -sSL -o x.tar.gz` on an HTTP 504 saves the error page and exits 0, so the step dies later in
 * `tar` with "not in gzip format": a message about neither the download nor the host, on a job that
 * looks like a code failure and fails again when re-run during the same outage.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Pinned two ways:
 *   - every `curl … -o <file>` in a shipped template or this repo's own workflows carries `--fail`,
 *     `--retry` and both timeouts (line scan, no YAML dependency, as the other template tests);
 *   - each CI template's real install step, run under `bash -e` as GitHub runs it, against a local
 *     server: a brief 504 installs the binary, a lasting 504 stops at curl naming the status.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const yamlsIn = (dir) => fs.readdirSync(path.join(REPO_ROOT, dir))
  .filter((f) => f.endsWith('.yml')).map((f) => path.posix.join(dir, f));
const CI_TEMPLATES = ['templates/ci-node.yml', 'templates/ci-python.yml', 'templates/ci-laravel.yml'];

// Every curl command writing a response to a file, continuation lines joined. Comment lines are
// prose, and `-o /dev/null` keeps no bytes: a status probe, not a download.
function downloadsIn(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i]) || !/\bcurl\s/.test(lines[i])) continue;
    let cmd = lines[i];
    while (/\\\s*$/.test(cmd) && i + 1 < lines.length) cmd = cmd.replace(/\\\s*$/, ' ') + lines[++i].trim();
    const o = cmd.match(/\s(?:-[a-zA-Z]*o|--output)\s+(\S+)/);
    if (o && o[1] !== '/dev/null') out.push(cmd.trim());
  }
  return out;
}

// True when `flag` is set either long or inside a short cluster such as -fsSL.
const hasFlag = (cmd, long, short) => new RegExp(`\\s--${long}(\\s|=|$)`).test(cmd)
  || (short ? new RegExp(`\\s-[a-zA-Z]*${short}[a-zA-Z]*(\\s|$)`).test(cmd) : false);

test('every binary download in a template or workflow fails loudly and retries', () => {
  const seen = {};
  for (const file of [...yamlsIn('templates'), ...yamlsIn('.github/workflows')]) {
    for (const cmd of downloadsIn(read(file))) {
      seen[file] = (seen[file] || 0) + 1;
      assert.ok(hasFlag(cmd, 'fail', 'f'), `${file}: no --fail, an error page is saved as the binary: ${cmd}`);
      assert.ok(hasFlag(cmd, 'retry'), `${file}: no --retry, a brief upstream error fails the job: ${cmd}`);
      assert.ok(hasFlag(cmd, 'connect-timeout'), `${file}: no --connect-timeout: ${cmd}`);
      assert.ok(hasFlag(cmd, 'max-time'), `${file}: no --max-time: ${cmd}`);
    }
  }
  // Not vacuous: the scan must still be finding the downloads this rule is about.
  for (const file of CI_TEMPLATES) assert.ok(seen[file] >= 1, `${file}: found no download to check`);
  assert.strictEqual(seen['.github/workflows/ci.yml'], 2, 'this repo\'s CI downloads gitleaks and actionlint');
});

test('the download scan sees what it must and skips what it should', () => {
  const found = (s) => downloadsIn(s).length;
  assert.strictEqual(found('curl -sSL -o a.tgz \\\n  "https://x/a.tgz"'), 1, 'a continued command');
  assert.strictEqual(found('curl -sSLo a.tgz https://x/a.tgz'), 1, 'a short cluster ending in o');
  assert.strictEqual(found('curl --output a.tgz https://x/a.tgz'), 1, 'the long spelling');
  assert.strictEqual(found('code=$(curl -s -o /dev/null -w "%{http_code}" "$U")'), 0, 'a status probe keeps no bytes');
  assert.strictEqual(found('BODY="$(curl -fsSL "$URL")"'), 0, 'a text fetch writes no file');
  assert.strictEqual(found('# curl -sSL -o a.tgz https://x/a.tgz'), 0, 'prose');
  const c = 'curl -sSL -o a.tgz https://x/a.tgz';
  assert.strictEqual(hasFlag(c, 'fail', 'f'), false, '-sSL holds no f, and the f in a.tgz or the URL is not a flag');
  assert.strictEqual(hasFlag('curl -fsSL -o a.tgz https://x/a.tgz', 'fail', 'f'), true);
  assert.strictEqual(hasFlag('curl --retry-delay 10 -o a https://x', 'retry'), false, '--retry-delay is not --retry');
});

// The `run: |` body of the named step, dedented: the script GitHub would hand to bash.
function installStep(file) {
  const lines = read(file).split(/\r?\n/);
  const at = lines.findIndex((l) => /- name: Install gitleaks/.test(l));
  assert.notStrictEqual(at, -1, `${file}: no gitleaks install step`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  const indent = lines[runAt + 1].match(/^\s*/)[0];
  const body = [];
  for (let i = runAt + 1; i < lines.length && (lines[i].startsWith(indent) || !lines[i].trim()); i++) {
    body.push(lines[i].slice(indent.length));
  }
  return body.join('\n');
}

// A fake release host: answers the listed status for each request in turn (the last repeats), and
// the given bytes on a 200. Bound to loopback, one per run.
function fakeHost(statuses, bytes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const status = statuses[Math.min(hits.length, statuses.length - 1)];
    hits.push(req.url);
    res.statusCode = status;
    res.end(status === 200 ? bytes : `<html>${status} Gateway Time-out</html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => server.close(),
  })));
}

// Runs a template's real step under `bash -e` (GitHub's default for `run:`), repointed at the fake
// host. Only the wait is shortened, so a run costs seconds: the flags themselves stay the template's.
function runStep(file, origin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-download-'));
  const runnerTemp = path.join(dir, 'runner-temp');
  fs.mkdirSync(runnerTemp);
  const githubPath = path.join(dir, 'github-path');
  const script = installStep(file)
    .replaceAll('https://github.com', origin)
    .replace(/--retry-delay \d+/, '--retry-delay 1');
  return new Promise((resolve) => {
    execFile('bash', ['-e', '-c', script], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, RUNNER_TEMP: runnerTemp, GITHUB_PATH: githubPath, GITLEAKS_VERSION: '8.30.1', no_proxy: '*' },
    }, (err, stdout, stderr) => resolve({
      code: err ? err.code : 0, stderr, binary: path.join(runnerTemp, 'gitleaks'), githubPath, runnerTemp, dir,
    }));
  });
}

function tarball() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-download-asset-'));
  fs.writeFileSync(path.join(dir, 'gitleaks'), '#!/bin/sh\necho fake\n');
  execFileSync('tar', ['-czf', 'a.tar.gz', 'gitleaks'], { cwd: dir });
  const bytes = fs.readFileSync(path.join(dir, 'a.tar.gz'));
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

// In parallel: each case spends its seconds waiting on curl's retry delay, not on the CPU.
test('each CI template\'s real install step', { concurrency: true }, async (t) => {
  await Promise.all(CI_TEMPLATES.flatMap((file) => [
    t.test(`${file}: a brief upstream 504 is retried and the binary installs`, async () => {
      const host = await fakeHost([504, 504, 200], tarball());
      const r = await runStep(file, host.origin);
      host.close();
      assert.strictEqual(r.code, 0, r.stderr);
      assert.strictEqual(host.hits.length, 3, 'two failures, then the success');
      assert.match(host.hits[0], /^\/gitleaks\/gitleaks\/releases\/download\/v8\.30\.1\/gitleaks_8\.30\.1_(darwin|linux)_(arm64|x64)\.tar\.gz$/);
      assert.ok(fs.statSync(r.binary).mode & 0o100, 'installed and executable');
      assert.strictEqual(fs.readFileSync(r.githubPath, 'utf8').trim(), r.runnerTemp);
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a lasting upstream 504 stops at curl, naming the status`, async () => {
      const host = await fakeHost([504], Buffer.alloc(0));
      const r = await runStep(file, host.origin);
      host.close();
      assert.strictEqual(r.code, 22, `curl's own exit for an HTTP error, got ${r.code}: ${r.stderr}`);
      assert.match(r.stderr, /\b504\b/, 'the message names the upstream status');
      assert.doesNotMatch(r.stderr, /gzip|tar:/, 'never reaches tar');
      assert.strictEqual(host.hits.length, 6, 'the first try plus five retries');
      assert.strictEqual(fs.existsSync(r.binary), false, 'nothing installed');
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
  ]));
});
