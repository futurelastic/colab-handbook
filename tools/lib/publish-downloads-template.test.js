'use strict';
/**
 * templates/publish-downloads.mjs — publish a final's files to a self-hosted downloads site (#648).
 * Run: node --test tools/lib/publish-downloads-template.test.js
 *
 * End to end against a local stand-in for the site: the REAL script (imported from templates/, no copy here to
 * drift) stages a fixture repo's files and uploads them with the REAL rsync into a directory, and every read-back
 * goes through a fetch that serves that directory — so "what a visitor reads" is the bytes rsync wrote. What each
 * assertion protects:
 *
 *   - the order: the version folder, then SHA256SUMS, installers, manifest.json, latest.json LAST;
 *   - a re-run of a complete version is a verified no-op (rsync is not called at all);
 *   - a dry run uploads nothing, before or after a publish;
 *   - an existing version with a different SHA256SUMS refuses and changes nothing (immutable);
 *   - an older final never moves latest.json back;
 *   - a candidate tag, a missing required file, a bad / reserved / `_` slug and a bad manifest refuse;
 *   - an unresolvable site name fails with a message naming the runner, not a stack trace.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'templates', 'publish-downloads.mjs');
const load = () => import(pathToFileURL(SCRIPT).href);
const HAS_RSYNC = spawnSync('sh', ['-c', 'command -v rsync'], { encoding: 'utf8' }).status === 0;
const BASE = 'https://dl.example.invalid';

const YML = `trunk: main
exposure: released
downloads:            # the block under test
  app: probe
  files:
    - probe-{v}.tgz
    - Probe_{v}_x64.dmg
  optional: [Probe_{v}_x64.msi]
  installers:
    - scripts/install.sh
stack: node
`;
const MANIFEST = {
  schema: 1,
  name: 'Probe',
  summary: { en: 'A probe app.', vi: 'Ứng dụng thử.' },
  install: {
    macos: { steps: ['Open the .dmg', 'Drag Probe to Applications'], prompts: ['"Unidentified developer" → Open anyway'] },
    linux: { steps: ['curl -fsSL <site>/probe/install.sh | sh'] },
  },
};

function tmp(p = 'pd-') { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }

/** A repo with the downloads: block, its manifest and installer; a Release assets dir; an empty site dir. */
function fixture({ yml = YML, manifest = MANIFEST, version = '1.2.0', extra = {} } = {}) {
  const base = tmp();
  const repo = path.join(base, 'repo');
  fs.mkdirSync(path.join(repo, '.github', 'downloads'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.writeFileSync(path.join(repo, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(repo, '.github', 'downloads', 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(repo, 'scripts', 'install.sh'), "#!/bin/sh\nBASE='@DOWNLOADS_URL@'\n");
  const assets = path.join(base, 'assets');
  fs.mkdirSync(assets);
  for (const n of [`probe-${version}.tgz`, `Probe_${version}_x64.dmg`, 'unrelated.zip'])
    fs.writeFileSync(path.join(assets, n), `${n} bytes ${extra[n] ?? ''}`);
  const site = path.join(base, 'site', 'probe'); // the upload account's root IS the app's folder
  fs.mkdirSync(site, { recursive: true });
  return { base, repo, assets, site };
}

/** fetch over the site directory: BASE/probe/<p> → <site>/<p>. */
function siteFetch(site, seen = []) {
  return async (url) => {
    seen.push(url);
    const rel = url.slice(`${BASE}/probe/`.length);
    const f = path.join(site, rel);
    if (!url.startsWith(`${BASE}/probe/`) || !fs.existsSync(f) || fs.statSync(f).isDirectory())
      return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(f), { status: 200 });
  };
}

/** A rsync that records each call and then runs the real one. */
function recordingRsync(base, calls) {
  const shim = path.join(base, 'rsync-shim');
  const log = path.join(base, 'rsync-calls.log');
  fs.rmSync(log, { force: true }); // one log per run
  fs.writeFileSync(shim, `#!/bin/sh\necho "$*" >> '${log}'\nexec rsync "$@"\n`, { mode: 0o755 });
  calls.read = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  return shim;
}

async function run(fx, { tag = 'v1.2.0', dryRun = false, env = {} } = {}) {
  const m = await load();
  const { config, manifest } = m.loadRepo(fx.repo, env);
  const outDir = tmp('pd-out-');
  await m.stage({ tag, assetsDir: fx.assets, outDir, baseUrl: BASE, root: fx.repo, config, manifest });
  const calls = {};
  const rsync = recordingRsync(fx.base, calls);
  const result = await m.publish({
    outDir, app: config.app, dest: `${fx.site}/`, baseUrl: BASE, dryRun, rsync,
    fetchImpl: siteFetch(fx.site), log: () => {},
  });
  return { result, calls: calls.read() };
}

test('parseDownloadsBlock: block lists, flow lists, comments; the next top-level key ends it', async () => {
  const m = await load();
  assert.deepStrictEqual(m.parseDownloadsBlock(YML), {
    app: 'probe', files: ['probe-{v}.tgz', 'Probe_{v}_x64.dmg'], optional: ['Probe_{v}_x64.msi'], installers: ['scripts/install.sh'],
  });
  assert.strictEqual(m.parseDownloadsBlock('trunk: main\n'), null);
  assert.throws(() => m.parseDownloadsBlock('downloads: {app: x}\n'), /as a block/);
  assert.throws(() => m.parseDownloadsBlock('downloads:\n  app:\n    nested: 1\n'), /line 3/);
});

test('readConfig refuses a bad, `_`-prefixed or reserved slug, unknown keys and duplicates', async () => {
  const m = await load();
  const ok = { app: 'probe', files: ['a-{v}'] };
  assert.strictEqual(m.readConfig(ok).manifest, m.DEFAULT_MANIFEST);
  assert.throws(() => m.readConfig({ ...ok, app: '_index' }), /belong to the site/);
  assert.throws(() => m.readConfig({ ...ok, app: 'Probe' }), /not a slug/);
  assert.throws(() => m.readConfig(ok, { reserved: ['probe'] }), /reserves/);
  assert.throws(() => m.readConfig({ ...ok, extra: 1 }), /not a key/);
  assert.throws(() => m.readConfig({ ...ok, optional: ['a-{v}'] }), /listed twice/);
  assert.throws(() => m.readConfig({ ...ok, files: ['../x'] }), /plain file name/);
  assert.throws(() => m.readConfig({ ...ok, installers: ['x/latest.json'] }), /collide/);
  assert.throws(() => m.readConfig(null), /no downloads: block/);
});

test('validateManifest names every problem', async () => {
  const m = await load();
  assert.doesNotThrow(() => m.validateManifest(MANIFEST));
  assert.throws(
    () => m.validateManifest({ name: 'X', summary: 'two\nlines', install: { beos: {}, linux: { steps: [] } }, foo: 1 }),
    (e) => /unknown field "foo"/.test(e.message) && /summary/.test(e.message) && /install\.beos/.test(e.message) && /install\.linux\.steps/.test(e.message),
  );
});

test('a candidate tag and a missing required file refuse before anything is staged', async () => {
  const m = await load();
  assert.throws(() => m.finalVersion('v1.2.0-rc.1'), /not a final tag/);
  const fx = fixture();
  fs.rmSync(path.join(fx.assets, 'Probe_1.2.0_x64.dmg'));
  const { config, manifest } = m.loadRepo(fx.repo);
  await assert.rejects(
    m.stage({ tag: 'v1.2.0', assetsDir: fx.assets, outDir: tmp(), baseUrl: BASE, root: fx.repo, config, manifest }),
    /lacks Probe_1\.2\.0_x64\.dmg — nothing was published/,
  );
});

test('an unresolvable site name fails naming the runner', async () => {
  const m = await load();
  await assert.rejects(m.assertResolves(BASE, async () => { const e = new Error('nope'); e.code = 'ENOTFOUND'; throw e; }),
    /dl\.example\.invalid does not resolve from this runner \(ENOTFOUND\).*runs-on/);
  await m.assertResolves(BASE, async () => ({ address: '10.0.0.1' }));
});

test('publish → order, read-back, stamped installer; re-run is a verified no-op; dry run sends nothing', { skip: !HAS_RSYNC && 'rsync not on PATH' }, async () => {
  const fx = fixture();

  const dry0 = await run(fx, { dryRun: true });
  assert.deepStrictEqual(dry0.calls, [], 'a dry run before publishing calls rsync zero times');
  assert.deepStrictEqual(fs.readdirSync(fx.site), [], 'and the site is untouched');

  const first = await run(fx);
  // order of the rsync calls: version folder (no SHA256SUMS), SHA256SUMS, installer, manifest, latest.json last
  assert.strictEqual(first.calls.length, 5, first.calls.join('\n'));
  assert.match(first.calls[0], /--ignore-existing --exclude SHA256SUMS .*\/1\.2\.0 /);
  assert.match(first.calls[1], /SHA256SUMS .*\/1\.2\.0\/$/);
  assert.match(first.calls[2], /install\.sh/);
  assert.match(first.calls[3], /manifest\.json/);
  assert.match(first.calls[4], /latest\.json/);
  assert.deepStrictEqual(first.result.uploaded.slice(-3), ['install.sh', 'manifest.json', 'latest.json']);
  assert.deepStrictEqual(fs.readdirSync(path.join(fx.site, '1.2.0')).sort(), ['Probe_1.2.0_x64.dmg', 'SHA256SUMS', 'probe-1.2.0.tgz']);
  assert.match(fs.readFileSync(path.join(fx.site, 'install.sh'), 'utf8'), /BASE='https:\/\/dl\.example\.invalid'/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.site, 'latest.json'), 'utf8')).version, '1.2.0');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fx.site, 'manifest.json'), 'utf8')), MANIFEST);

  const again = await run(fx);
  assert.deepStrictEqual(again.calls, [], 'a re-run of a complete version calls rsync zero times');
  assert.deepStrictEqual(again.result.uploaded, []);
  assert.deepStrictEqual(again.result.unchanged, ['install.sh', 'manifest.json', 'latest.json']);

  const dry1 = await run(fx, { dryRun: true });
  assert.deepStrictEqual(dry1.calls, [], 'a dry run after publishing calls rsync zero times');
});

test('a published version is immutable: a different build of it refuses and changes nothing', { skip: !HAS_RSYNC && 'rsync not on PATH' }, async () => {
  const fx = fixture();
  await run(fx);
  const before = fs.readFileSync(path.join(fx.site, '1.2.0', 'SHA256SUMS'), 'utf8');
  fs.writeFileSync(path.join(fx.assets, 'probe-1.2.0.tgz'), 'a rebuilt, different tarball');
  await assert.rejects(run(fx), /already published and its SHA256SUMS differs/);
  assert.strictEqual(fs.readFileSync(path.join(fx.site, '1.2.0', 'SHA256SUMS'), 'utf8'), before);
});

test('an older final is published but never moves latest.json back', { skip: !HAS_RSYNC && 'rsync not on PATH' }, async () => {
  const fx = fixture();
  await run(fx);
  for (const n of ['probe-1.1.9.tgz', 'Probe_1.1.9_x64.dmg']) fs.writeFileSync(path.join(fx.assets, n), n);
  const old = await run(fx, { tag: 'v1.1.9' });
  assert.strictEqual(old.result.skippedLatest, true);
  assert.ok(!old.calls.some((c) => /latest\.json/.test(c)));
  assert.ok(fs.existsSync(path.join(fx.site, '1.1.9', 'SHA256SUMS')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.site, 'latest.json'), 'utf8')).version, '1.2.0');
});

test('the CLI: check and names read project.yml; an optional file is listed', async () => {
  const fx = fixture();
  const cli = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, '--root', fx.repo], { encoding: 'utf8' });
  const c = cli('check');
  assert.strictEqual(c.status, 0, c.stderr);
  assert.match(c.stdout, /downloads: probe — 2 file\(s\), 1 optional, 1 installer\(s\)/);
  const n = cli('names', 'v2.0.1');
  assert.deepStrictEqual(n.stdout.trim().split('\n'), ['probe-2.0.1.tgz', 'Probe_2.0.1_x64.dmg', 'Probe_2.0.1_x64.msi']);
  const rc = cli('names', 'v2.0.1-rc.3');
  assert.strictEqual(rc.status, 1);
  assert.match(rc.stderr, /not a final tag/);
  fs.writeFileSync(path.join(fx.repo, '.github', 'downloads', 'manifest.json'), '{"name":"X"}');
  const bad = cli('check');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /manifest\.json: .*summary/);
});
