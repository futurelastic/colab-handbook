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
 *
 * And kept between jobs (#696): a release download that answers 504 for hours outlasts any retry, so
 * the step installs into the runner's tool cache and reuses what it finds there — a runner that has the
 * pinned binary installs it with no request at all, even while the host answers 504 to everything.
 *
 * And authenticated and verified (#698): GitHub sheds anonymous release downloads first under load,
 * so the step asks the API for the asset with the job's token, and checks its sha256 against the
 * release's checksums file before tar. The fake host is therefore a fake GitHub — an API that answers
 * the release by tag and each asset with a 302, and a separate CDN host behind it — and the cases
 * pin that the token is sent to the API and never follows the redirect.
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

// The pinned version, and the asset names the step derives from it.
const VERSION = '8.30.1';
const PLATFORM = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const ASSET = `gitleaks_${VERSION}_${PLATFORM.replace('-', '_')}.tar.gz`;
const SUMS = `gitleaks_${VERSION}_checksums.txt`;
const OTHER_ASSETS = ['darwin_arm64', 'darwin_x64', 'linux_arm64', 'linux_x64']
  .map((p) => `gitleaks_${VERSION}_${p}.tar.gz`).filter((n) => n !== ASSET);
const TOKEN = 'test-token';
const sha256 = (bytes) => require('crypto').createHash('sha256').update(bytes).digest('hex');

// A fake GitHub (#698): an API host and, apart from it, a download CDN — the way the real one
// works. The API answers the release by tag and each asset by id with a 302 to the CDN; the CDN
// serves the bytes. `statuses` are the API's answers for each request in turn (the last repeats);
// the CDN always answers 200. Both bound to loopback, one pair per run. The CDN is addressed as
// `localhost` and the API as `127.0.0.1`, so to curl they are two hosts — which is what lets a
// test see whether the token follows the redirect.
//
//   bytes      the tarball served for every platform asset
//   sums       the checksums file; defaults to the real sha256 of `bytes` for every asset
//   assets     names the release lists, in order; defaults to the checksums file plus all platforms
//   compact    serve the release JSON without whitespace (the API may; the parse must not care)
async function fakeGitHub(statuses, bytes, { sums, assets, compact } = {}) {
  const names = assets || [SUMS, ...OTHER_ASSETS, ASSET];
  sums = sums !== undefined ? sums
    : names.filter((n) => n !== SUMS).map((n) => `${sha256(bytes)}  ${n}\n`).join('');
  const hits = [];
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

  const cdn = http.createServer((req, res) => {
    hits.push({ host: 'cdn', url: req.url, auth: req.headers.authorization, accept: req.headers.accept });
    const name = names[Number(req.url.split('/').pop())];
    res.end(name === SUMS ? sums : bytes);
  });
  const cdnOrigin = `http://localhost:${await listen(cdn)}`;

  let origin;
  const api = http.createServer((req, res) => {
    const apiHits = hits.filter((h) => h.host === 'api').length;
    const status = statuses[Math.min(apiHits, statuses.length - 1)];
    hits.push({ host: 'api', url: req.url, auth: req.headers.authorization, accept: req.headers.accept });
    if (status !== 200) { res.statusCode = status; return res.end(`<html>${status} Gateway Time-out</html>`); }
    if (req.url === `/repos/gitleaks/gitleaks/releases/tags/v${VERSION}`) {
      // The real field order: url, id, node_id, name — then an uploader whose own url and id are not
      // an asset's. The release's own name comes first, and is not an asset's name either.
      const release = {
        url: `${origin}/repos/gitleaks/gitleaks/releases/1`, name: `v${VERSION}`,
        assets: names.map((n, id) => ({
          url: `${origin}/repos/gitleaks/gitleaks/releases/assets/${id}`, id, node_id: `RA_${id}`, name: n, label: '',
          uploader: { login: 'someone', id: 99, url: `${origin}/users/someone` },
          browser_download_url: `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${n}`,
        })),
        body: 'Changelog, with commas, {braces} and [brackets]',
      };
      res.setHeader('content-type', 'application/json');
      return res.end(compact ? JSON.stringify(release) : JSON.stringify(release, null, 2));
    }
    const m = req.url.match(/^\/repos\/gitleaks\/gitleaks\/releases\/assets\/(\d+)$/);
    if (m && names[Number(m[1])]) {
      res.statusCode = 302;
      res.setHeader('location', `${cdnOrigin}/blob/${m[1]}`);
      return res.end();
    }
    res.statusCode = 404;
    res.end('{"message":"Not Found"}');
  });
  origin = `http://127.0.0.1:${await listen(api)}`;

  return {
    origin, hits,
    api: () => hits.filter((h) => h.host === 'api'),
    cdn: () => hits.filter((h) => h.host === 'cdn'),
    close: () => { api.close(); cdn.close(); },
  };
}

// A fresh runner: its own temp dir, and a tool cache that persists only if the caller passes the same
// `toolCache` to a second run. `toolCache: null` leaves RUNNER_TOOL_CACHE unset.
function runner({ toolCache } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-download-'));
  const runnerTemp = path.join(dir, 'runner-temp');
  fs.mkdirSync(runnerTemp);
  if (toolCache === undefined) { toolCache = path.join(dir, 'tool-cache'); fs.mkdirSync(toolCache); }
  const installDir = path.join(toolCache || runnerTemp, 'gitleaks', VERSION, PLATFORM);
  return { dir, runnerTemp, toolCache, installDir, binary: path.join(installDir, 'gitleaks') };
}

// Runs a template's real step under `bash -e` (GitHub's default for `run:`), repointed at the fake
// API. Only the wait is shortened, so a run costs seconds: the flags themselves stay the template's.
function runStep(file, origin, rn = runner()) {
  const githubPath = path.join(rn.dir, `github-path-${Date.now()}-${Math.random()}`);
  const script = installStep(file)
    .replaceAll('https://api.github.com', origin)
    .replace(/--retry-delay \d+/, '--retry-delay 1');
  // A step still reaching the anonymous download host is never run: it would leave the loopback fake
  // for the real internet. Returned as a failed run, not thrown, so the caller still closes its hosts.
  if (/https:\/\/github\.com\//.test(script)) {
    return Promise.resolve({ ...rn, code: -1, stdout: '', stderr: '', out: `${file}: the step still reaches the anonymous download host https://github.com`, leftovers: [] });
  }
  const env = { PATH: process.env.PATH, HOME: rn.dir, RUNNER_TEMP: rn.runnerTemp, GITHUB_PATH: githubPath, GITLEAKS_VERSION: VERSION, GH_TOKEN: TOKEN, no_proxy: '*' };
  if (rn.toolCache) env.RUNNER_TOOL_CACHE = rn.toolCache;
  return new Promise((resolve) => {
    execFile('bash', ['-e', '-c', script], { cwd: rn.dir, env }, (err, stdout, stderr) => resolve({
      ...rn, code: err ? err.code : 0, stdout, stderr, out: stdout + stderr, githubPath,
      // Everything the step left beside the install dir: a temp dir here is litter on a persistent runner.
      leftovers: fs.existsSync(path.dirname(rn.installDir))
        ? fs.readdirSync(path.dirname(rn.installDir)).filter((n) => n !== PLATFORM) : [],
    }));
  });
}

function tarball(content = '#!/bin/sh\necho fake\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-download-asset-'));
  fs.writeFileSync(path.join(dir, 'gitleaks'), content);
  execFileSync('tar', ['-czf', 'a.tar.gz', 'gitleaks'], { cwd: dir });
  const bytes = fs.readFileSync(path.join(dir, 'a.tar.gz'));
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes;
}

// A refused download: non-zero, nothing installed, nothing left behind, tar never reached.
function assertRefused(r, message) {
  assert.notStrictEqual(r.code, 0, `the step must fail: ${r.out}`);
  assert.match(r.out, message);
  assert.doesNotMatch(r.out, /gzip|tar:/, 'stops before tar');
  assert.strictEqual(fs.existsSync(r.binary), false, 'nothing installed');
  assert.deepStrictEqual(r.leftovers, [], 'no temp dir left in the tool cache');
}

// In parallel: each case spends its seconds waiting on curl's retry delay, not on the CPU.
test('each CI template\'s real install step', { concurrency: true }, async (t) => {
  await Promise.all(CI_TEMPLATES.flatMap((file) => [
    t.test(`${file}: a brief upstream 504 is retried and the binary installs`, async () => {
      const gh = await fakeGitHub([504, 504, 200], tarball());
      const r = await runStep(file, gh.origin);
      gh.close();
      assert.strictEqual(r.code, 0, r.out);
      // Two failures, then the release, then each asset: the API's 302, the CDN's bytes.
      assert.strictEqual(gh.api().length, 5, JSON.stringify(gh.hits));
      assert.strictEqual(gh.cdn().length, 2);
      assert.strictEqual(gh.api()[0].url, `/repos/gitleaks/gitleaks/releases/tags/v${VERSION}`);
      assert.ok(fs.statSync(r.binary).mode & 0o100, 'installed into the tool cache, executable');
      assert.ok(r.binary.startsWith(r.toolCache + path.sep), 'under RUNNER_TOOL_CACHE, not RUNNER_TEMP');
      assert.strictEqual(fs.readFileSync(r.githubPath, 'utf8').trim(), r.installDir);
      assert.deepStrictEqual(r.leftovers, [], 'no temp dir left in the tool cache');
      assert.deepStrictEqual(fs.readdirSync(r.dir).filter((n) => /\.tar\.gz$/.test(n)), [], 'no tarball left in the workspace');
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: every request is authenticated, and the token never reaches the download host (#698)`, async () => {
      const gh = await fakeGitHub([200], tarball());
      const r = await runStep(file, gh.origin);
      gh.close();
      assert.strictEqual(r.code, 0, r.out);
      for (const h of gh.api()) assert.strictEqual(h.auth, `Bearer ${TOKEN}`, `unauthenticated API request: ${h.url}`);
      assert.match(gh.api()[0].accept, /application\/vnd\.github\+json/);
      // This platform's asset and the checksums file, by the ids the release gave them — not a neighbour's.
      const ids = gh.api().slice(1).map((h) => Number(h.url.split('/').pop()));
      const names = [SUMS, ...OTHER_ASSETS, ASSET];
      assert.deepStrictEqual(ids.map((id) => names[id]), [ASSET, SUMS]);
      for (const h of gh.api().slice(1)) assert.strictEqual(h.accept, 'application/octet-stream', 'the bytes, not the asset\'s JSON');
      for (const h of gh.cdn()) assert.strictEqual(h.auth, undefined, 'curl must drop the token on the redirect to another host');
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: the release JSON may come compact`, async () => {
      const gh = await fakeGitHub([200], tarball(), { compact: true, assets: [ASSET, SUMS, ...OTHER_ASSETS] });
      const r = await runStep(file, gh.origin);
      gh.close();
      assert.strictEqual(r.code, 0, r.out);
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a lasting upstream 504 stops at curl, naming the status`, async () => {
      const gh = await fakeGitHub([504], Buffer.alloc(0));
      const r = await runStep(file, gh.origin);
      gh.close();
      assert.strictEqual(r.code, 22, `curl's own exit for an HTTP error, got ${r.code}: ${r.out}`);
      assert.match(r.stderr, /\b504\b/, 'the message names the upstream status');
      assertRefused(r, /504/);
      assert.strictEqual(gh.api().length, 6, 'the first try plus five retries');
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a tarball whose sha256 is not the release's is refused before tar (#698)`, async () => {
      const gh = await fakeGitHub([200], tarball(), { sums: `${'0'.repeat(64)}  ${ASSET}\n` });
      const r = await runStep(file, gh.origin);
      gh.close();
      assertRefused(r, new RegExp(`sha256 mismatch for ${ASSET.replaceAll('.', '\\.')}: got [0-9a-f]{64}, ${SUMS.replaceAll('.', '\\.')} lists 0{64}`));
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a tarball the checksums file does not list is refused`, async () => {
      const gh = await fakeGitHub([200], tarball(), { sums: `${'a'.repeat(64)}  ${OTHER_ASSETS[0]}\n` });
      const r = await runStep(file, gh.origin);
      gh.close();
      assertRefused(r, /does not list .*cannot be verified/);
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a release with no asset for this platform is refused, naming it`, async () => {
      const gh = await fakeGitHub([200], tarball(), { assets: [SUMS, ...OTHER_ASSETS] });
      const r = await runStep(file, gh.origin);
      gh.close();
      assertRefused(r, new RegExp(`has no asset ${ASSET.replaceAll('.', '\\.')}`));
      assert.strictEqual(gh.api().length, 1, 'only the release was asked for');
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: a runner that installed it once needs no download again, even through a lasting 504`, async () => {
      const ok = await fakeGitHub([200], tarball());
      const rn = runner();
      const first = await runStep(file, ok.origin, rn);
      ok.close();
      assert.strictEqual(first.code, 0, first.out);
      assert.strictEqual(ok.api().length, 3);
      // The outage #696 measured: the release host answers 504 to everything, for hours.
      const down = await fakeGitHub([504], Buffer.alloc(0));
      const second = await runStep(file, down.origin, rn);
      down.close();
      assert.strictEqual(second.code, 0, second.out);
      assert.strictEqual(down.hits.length, 0, 'no request reaches the host');
      assert.match(second.stdout, /already on this runner/);
      assert.strictEqual(fs.readFileSync(second.githubPath, 'utf8').trim(), rn.installDir);
      fs.rmSync(rn.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: the cache is per version — a pin bump downloads, never reuses the old binary`, async () => {
      const rn = runner();
      const old = path.join(rn.toolCache, 'gitleaks', '8.29.0', PLATFORM);
      fs.mkdirSync(old, { recursive: true });
      fs.writeFileSync(path.join(old, 'gitleaks'), '#!/bin/sh\necho old\n', { mode: 0o755 });
      const gh = await fakeGitHub([200], tarball());
      const r = await runStep(file, gh.origin, rn);
      gh.close();
      assert.strictEqual(r.code, 0, r.out);
      assert.strictEqual(gh.cdn().length, 2, `${VERSION} is not on the runner, so it is downloaded`);
      assert.strictEqual(fs.readFileSync(r.githubPath, 'utf8').trim(), r.installDir);
      fs.rmSync(rn.dir, { recursive: true, force: true });
    }),
    t.test(`${file}: with no RUNNER_TOOL_CACHE it still installs, into RUNNER_TEMP`, async () => {
      const gh = await fakeGitHub([200], tarball());
      const r = await runStep(file, gh.origin, runner({ toolCache: null }));
      gh.close();
      assert.strictEqual(r.code, 0, r.out);
      assert.ok(r.binary.startsWith(r.runnerTemp + path.sep));
      assert.ok(fs.statSync(r.binary).mode & 0o100);
      fs.rmSync(r.dir, { recursive: true, force: true });
    }),
  ]));
});

// This repo's own CI (#698): not run here — it is linux-x64-only and installs with sudo — but its
// gitleaks job runs it on every push. Pinned statically to the same three properties.
test('this repo\'s own gitleaks install is authenticated and verified too', () => {
  const ci = read('.github/workflows/ci.yml');
  const at = ci.indexOf('- name: Install gitleaks');
  const step = ci.slice(at, ci.indexOf('- name: gitleaks detect', at));
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /-H "Authorization: Bearer \$\{GH_TOKEN\}"/);
  assert.match(step, /https:\/\/api\.github\.com\/repos\/gitleaks\/gitleaks\/releases\/tags\//);
  assert.doesNotMatch(step, /https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download/, 'no anonymous download left');
  assert.match(step, /sha256sum -c --strict/);
  assert.ok(step.indexOf('sha256sum') < step.indexOf('tar -xzf'), 'verified before extracting');
});
