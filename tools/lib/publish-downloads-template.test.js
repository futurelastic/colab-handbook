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
 *   - an unresolvable site name fails with a message naming the runner, not a stack trace;
 *   - `requires` (#653): a malformed entry refuses; publish refuses a slug with no final, a final older than `min`
 *     and a cycle through the site's manifests before rsync is called; the list is stamped into the installers;
 *   - the reference installers in docs/downloads.md (#653), extracted from the doc and run against a stand-in
 *     site over HTTP: dependencies first, each once, a satisfied one left alone, a cycle / a missing / a failing
 *     dependency stops before the app, INSTALL_SKIP_REQUIRES=1 installs only the app. The PowerShell one runs where
 *     `pwsh` is on PATH (CI's Linux runners carry it).
 *   - the portal fields (#655): every new field optional and shape-checked; the icon and screenshot files checked
 *     (present, <= 1 MB, bytes matching the name, a square icon, one name each) at load; published inside the version
 *     folder and its SHA256SUMS but not latest.json's `files`; read back; the site's manifest names them `X.Y.Z/<name>`
 *     and has `<site>` stamped; a changed image of a published version refuses, naming it.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
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

/** fetch over the site directory: BASE/<app>/<p> → <site>/../<app>/<p> (the site holds every app's folder). */
function siteFetch(site, seen = []) {
  return async (url) => {
    seen.push(url);
    const rel = url.slice(`${BASE}/`.length);
    const f = path.join(path.dirname(site), rel);
    if (!url.startsWith(`${BASE}/`) || rel.split('/').includes('..') || !fs.existsSync(f) || fs.statSync(f).isDirectory())
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
  // the site's copy has <site> replaced by the site root (#655); the repo's keeps the token
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fx.site, 'manifest.json'), 'utf8')),
    { ...MANIFEST, install: { ...MANIFEST.install, linux: { steps: [`curl -fsSL ${BASE}/probe/install.sh | sh`] } } });

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

// ── requires (#653) ──────────────────────────────────────────────────────────────────────────────

/** Puts another app on the fixture's site: its latest.json (a final at `version`) and manifest.json. */
function siteApp(fx, slug, { version = '1.0.0', requires } = {}) {
  const dir = path.join(path.dirname(fx.site), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ version, files: {} }));
  const manifest = { name: slug, summary: 'x', install: { linux: { steps: ['x'] } }, ...(requires ? { requires } : {}) };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

function withRequires(requires, installer = "#!/bin/sh\nBASE='@DOWNLOADS_URL@'\nREQUIRES='@DOWNLOADS_REQUIRES@'\n") {
  const fx = fixture({ manifest: { ...MANIFEST, requires } });
  fs.writeFileSync(path.join(fx.repo, 'scripts', 'install.sh'), installer);
  return fx;
}

test('requires: a malformed entry, a duplicate, the app itself and an installer with no stamp point refuse', async () => {
  const m = await load();
  assert.doesNotThrow(() => m.validateManifest({ ...MANIFEST, requires: [{ slug: 'svc', min: '2.1.0' }] }));
  assert.throws(
    () => m.validateManifest({ ...MANIFEST, requires: [{ slug: 'Svc', min: '2' }, { slug: 'a', min: '1.0.0', at: 1 }, 'b', { slug: 'a', min: '1.0.0' }] }),
    (e) => /requires\[0\]\.slug/.test(e.message) && /requires\[0\]\.min/.test(e.message) && /requires\[1\]\.at: unknown/.test(e.message)
      && /requires\[2\]: an object/.test(e.message) && /requires\[3\]\.slug: a is listed twice/.test(e.message),
  );
  assert.throws(() => m.validateManifest({ ...MANIFEST, requires: 'svc' }), /requires: a list/);
  assert.throws(() => m.loadRepo(withRequires([{ slug: 'probe', min: '1.0.0' }]).repo), /requires names probe itself/);
  assert.throws(() => m.loadRepo(withRequires([{ slug: 'svc', min: '1.0.0' }], "#!/bin/sh\nBASE='@DOWNLOADS_URL@'\n").repo),
    /scripts\/install\.sh has no @DOWNLOADS_REQUIRES@/);
  // no requires: the old installer (no second placeholder) still loads, and stamps nothing
  assert.doesNotThrow(() => m.loadRepo(fixture().repo));
});

test('requires: stamped into the installers in order; `check` names them', async () => {
  const m = await load();
  const fx = withRequires([{ slug: 'svc', min: '2.1.0' }, { slug: 'layer', min: '0.3.0' }]);
  const { config, manifest } = m.loadRepo(fx.repo);
  const outDir = tmp('pd-out-');
  await m.stage({ tag: 'v1.2.0', assetsDir: fx.assets, outDir, baseUrl: BASE, root: fx.repo, config, manifest });
  assert.match(fs.readFileSync(path.join(outDir, 'install.sh'), 'utf8'), /REQUIRES='svc:2\.1\.0 layer:0\.3\.0'/);
  const c = spawnSync(process.execPath, [SCRIPT, 'check', '--root', fx.repo], { encoding: 'utf8' });
  assert.strictEqual(c.status, 0, c.stderr);
  assert.match(c.stdout, /requires svc:2\.1\.0 layer:0\.3\.0/);
  // an app with no requires stamps an empty list
  const plain = fixture();
  fs.writeFileSync(path.join(plain.repo, 'scripts', 'install.sh'), "BASE='@DOWNLOADS_URL@'\nREQUIRES='@DOWNLOADS_REQUIRES@'\n");
  const p = m.loadRepo(plain.repo);
  const out2 = tmp('pd-out-');
  await m.stage({ tag: 'v1.2.0', assetsDir: plain.assets, outDir: out2, baseUrl: BASE, root: plain.repo, ...p });
  assert.match(fs.readFileSync(path.join(out2, 'install.sh'), 'utf8'), /REQUIRES=''/);
});

test('requires: the site must carry every slug at a final >= min, and no cycle', async () => {
  const m = await load();
  const fx = fixture();
  const check = (requires) => m.checkRequires({ app: 'probe', manifest: { requires }, baseUrl: BASE, fetchImpl: siteFetch(fx.site) });
  await assert.rejects(check([{ slug: 'svc', min: '1.0.0' }]), /svc \(required by probe\) has no final on the site/);
  siteApp(fx, 'svc', { version: '2.0.0', requires: [{ slug: 'layer', min: '0.3.0' }] });
  await assert.rejects(check([{ slug: 'svc', min: '2.1.0' }]), /probe needs svc >= 2\.1\.0, and the site's newest final of it is 2\.0\.0/);
  await assert.rejects(check([{ slug: 'svc', min: '1.0.0' }]), /layer \(required by probe → svc\) has no final/);
  siteApp(fx, 'layer', { version: '0.3.0' });
  // a diamond is not a cycle, and each app is visited once
  siteApp(fx, 'cli', { version: '1.0.0', requires: [{ slug: 'layer', min: '0.1.0' }] });
  assert.deepStrictEqual(await check([{ slug: 'svc', min: '1.0.0' }, { slug: 'cli', min: '1.0.0' }]), ['svc', 'layer', 'cli']);
  // back to this app, and round a loop that does not include it
  siteApp(fx, 'layer', { version: '0.3.0', requires: [{ slug: 'probe', min: '1.0.0' }] });
  await assert.rejects(check([{ slug: 'svc', min: '1.0.0' }]), /a cycle — probe → svc → layer → probe/);
  siteApp(fx, 'layer', { version: '0.3.0', requires: [{ slug: 'svc', min: '1.0.0' }] });
  await assert.rejects(check([{ slug: 'svc', min: '1.0.0' }]), /a cycle — probe → svc → layer → svc/);
});

test('requires: publish refuses before rsync is called, a dry run too', { skip: !HAS_RSYNC && 'rsync not on PATH' }, async () => {
  const fx = withRequires([{ slug: 'svc', min: '1.0.0' }]);
  for (const dryRun of [true, false]) {
    const calls = {};
    const m = await load();
    const { config, manifest } = m.loadRepo(fx.repo);
    const outDir = tmp('pd-out-');
    await m.stage({ tag: 'v1.2.0', assetsDir: fx.assets, outDir, baseUrl: BASE, root: fx.repo, config, manifest });
    const rsync = recordingRsync(fx.base, calls);
    await assert.rejects(
      m.publish({ outDir, app: 'probe', dest: `${fx.site}/`, baseUrl: BASE, dryRun, rsync, fetchImpl: siteFetch(fx.site), log: () => {} }),
      /svc \(required by probe\) has no final on the site/,
    );
    assert.deepStrictEqual(calls.read(), [], `dryRun=${dryRun}: rsync never called`);
    assert.deepStrictEqual(fs.readdirSync(fx.site), [], 'and the site is untouched');
  }
  siteApp(fx, 'svc', { version: '1.0.0' });
  const ok = await run(fx);
  assert.deepStrictEqual(ok.result.requires, ['svc']);
  assert.match(fs.readFileSync(path.join(fx.site, 'install.sh'), 'utf8'), /REQUIRES='svc:1\.0\.0'/);
});

// ── the reference installers in docs/downloads.md ───────────────────────────────────────────────

const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'downloads.md'), 'utf8');

/** The doc's fenced block in `lang` that starts with `first`, exactly once — the doc is the one source. */
function docBlock(lang, first) {
  const blocks = [...DOC.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```', 'g'))].map((x) => x[1]).filter((b) => b.startsWith(first));
  assert.strictEqual(blocks.length, 1, `docs/downloads.md carries one ${lang} reference installer`);
  return blocks[0];
}

/** Replaces exactly one match — so a doc edit that moves an EDIT point fails here, loudly. */
function once(text, re, by) {
  assert.strictEqual((text.match(new RegExp(re.source, re.flags.replace('g', '') + 'g')) || []).length, 1, `one ${re}`);
  return text.replace(re, by);
}

const INSTALLERS = {
  sh: {
    file: 'install.sh',
    block: () => docBlock('sh', '#!/bin/sh'),
    app: /^APP=myapp /m,
    fns: [/^installed_version\(\) \{.*\n[\s\S]*?^\}\n/m, /^install_app\(\) \{.*\n[\s\S]*?^\}\n/m],
    make: (slug, version, fail, noVersion) => [
      `APP=${slug} `,
      noVersion ? 'installed_version() { :; }\n' : 'installed_version() { cat "$PREFIX/$APP.version" 2>/dev/null || true; }\n',
      fail
        ? 'install_app() { echo "checksum mismatch on $APP" >&2; exit 1; }\n'
        : `install_app() { echo ${version} > "$PREFIX/$APP.version"; echo "$APP" >> "$PREFIX/order"; }\n`,
    ],
    cmd: (file) => ['sh', [file]],
  },
  ps1: {
    file: 'install.ps1',
    block: () => docBlock('powershell', '# Installs myapp'),
    app: /^\$App = 'myapp' /m,
    fns: [/^function Get-InstalledVersion \{.*\n[\s\S]*?^\}\n/m, /^function Install-App \{.*\n[\s\S]*?^\}\n/m],
    make: (slug, version, fail, noVersion) => [
      `$App = '${slug}' `,
      noVersion ? 'function Get-InstalledVersion { $null }\n' : 'function Get-InstalledVersion { $f = Join-Path $env:PREFIX "$App.version"; if (Test-Path $f) { [version](Get-Content -Raw $f).Trim() } }\n',
      fail
        ? 'function Install-App { throw "checksum mismatch on $App" }\n'
        : `function Install-App { Set-Content -Path (Join-Path $env:PREFIX "$App.version") -Value '${version}'; Add-Content -Path (Join-Path $env:PREFIX order) -Value $App }\n`,
    ],
    cmd: (file) => ['pwsh', ['-NoProfile', '-NonInteractive', '-File', file]],
  },
};

const HAS_PWSH = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).status === 0;

/** A stand-in site over HTTP (a real fetch, as curl / Invoke-WebRequest make it) serving `dir`. */
async function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(dir, rel);
    if (rel.split('/').includes('..') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200);
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Async, so the stand-in site keeps answering while the installer runs. Bounded: an installer whose cycle guard is
 * broken recurses forever, and that must fail here, not hang the run. The installer leads its own process group so
 * the timeout reaps every nested installer with it.
 */
function runInstaller(cmd, args, env, ms = 60000) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { detached: true, env: { PATH: process.env.PATH, HOME: process.env.HOME || os.tmpdir(), TMPDIR: os.tmpdir(), ...env } });
    let out = '';
    const timer = setTimeout(() => { out += `\n[timed out after ${ms} ms]`; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, ms);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    // pwsh colours an error and wraps it at the console width (`     | …` continuation lines): read it as one line
    const plain = () => out.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r?\n\s*\|\s*/g, ' ');
    child.on('close', (status) => { clearTimeout(timer); resolveRun({ status, out: plain() }); });
  });
}

for (const [kind, I] of Object.entries(INSTALLERS)) {
  test(`the reference ${kind} installer: requires first, once each, satisfied ones left alone; cycle, missing and failure stop before the app; opt-out`,
    { skip: kind === 'ps1' && !HAS_PWSH && 'pwsh not on PATH' }, async () => {
      const m = await load();
      const base = tmp('pd-inst-');
      const siteDir = path.join(base, 'site');
      const site = await serve(siteDir);
      /** Publishes app `slug` to the stand-in site: its installer, the requires stamped as the publish does. */
      const app = (slug, { version = '1.0.0', requires = [], fail = false, noVersion = false } = {}) => {
        const [appLine, versionFn, installFn] = I.make(slug, version, fail, noVersion);
        let text = once(I.block(), I.app, appLine);
        text = once(text, I.fns[0], versionFn);
        text = once(text, I.fns[1], installFn);
        text = text.split(m.PLACEHOLDER).join('https://dl.example.invalid').split(m.REQUIRES_PLACEHOLDER).join(m.requiresStamp({ requires }));
        fs.mkdirSync(path.join(siteDir, slug), { recursive: true });
        fs.writeFileSync(path.join(siteDir, slug, I.file), text);
      };
      const prefix = () => { const p = tmp('pd-prefix-'); return p; };
      const order = (p) => (fs.existsSync(path.join(p, 'order')) ? fs.readFileSync(path.join(p, 'order'), 'utf8').trim().split(/\r?\n/).filter(Boolean) : []);
      const install = (slug, p, env = {}) => {
        const [cmd, args] = I.cmd(path.join(siteDir, slug, I.file));
        return runInstaller(cmd, args, { DOWNLOADS_SITE: site.url, PREFIX: p, ...env });
      };
      try {
        app('a', { version: '3.0.0', requires: [{ slug: 'b', min: '1.0.0' }, { slug: 'c', min: '2.0.0' }] });
        app('b', { version: '1.0.0', requires: [{ slug: 'c', min: '1.0.0' }] });
        app('c', { version: '2.0.0' });

        // nothing installed: c (through b), b, then a — and c only once, though both a and b require it
        const p1 = prefix();
        let r = await install('a', p1);
        assert.strictEqual(r.status, 0, r.out);
        assert.deepStrictEqual(order(p1), ['c', 'b', 'a'], r.out);

        // once per run even where no version check could tell: k has none, so only the run's list keeps it to one install
        app('g', { requires: [{ slug: 'h', min: '1.0.0' }, { slug: 'k', min: '1.0.0' }] });
        app('h', { requires: [{ slug: 'k', min: '1.0.0' }] });
        app('k', { noVersion: true });
        const p0 = prefix();
        r = await install('g', p0);
        assert.strictEqual(r.status, 0, r.out);
        assert.deepStrictEqual(order(p0), ['k', 'h', 'g'], r.out);

        // b already at its min, c older than a's min: only c is installed again, then a
        const p2 = prefix();
        fs.writeFileSync(path.join(p2, 'b.version'), '1.0.0\n');
        fs.writeFileSync(path.join(p2, 'c.version'), '1.5.0\n');
        r = await install('a', p2);
        assert.strictEqual(r.status, 0, r.out);
        assert.deepStrictEqual(order(p2), ['c', 'a'], r.out);
        assert.match(r.out, /b 1\.0\.0 is installed \(>= 1\.0\.0\)/);

        // the opt-out installs the app alone
        const p3 = prefix();
        r = await install('a', p3, { INSTALL_SKIP_REQUIRES: '1' });
        assert.strictEqual(r.status, 0, r.out);
        assert.deepStrictEqual(order(p3), ['a'], r.out);

        // a cycle stops before anything is installed
        app('x', { requires: [{ slug: 'y', min: '1.0.0' }] });
        app('y', { requires: [{ slug: 'x', min: '1.0.0' }] });
        const p4 = prefix();
        r = await install('x', p4);
        assert.notStrictEqual(r.status, 0, r.out);
        assert.match(r.out, /a cycle: x y x/);
        assert.deepStrictEqual(order(p4), [], r.out);

        // a dependency not on the site, and one whose install fails: named, and the app is not installed
        app('m', { requires: [{ slug: 'c', min: '1.0.0' }, { slug: 'nope', min: '1.0.0' }] });
        const p5 = prefix();
        r = await install('m', p5);
        assert.notStrictEqual(r.status, 0, r.out);
        assert.match(r.out, /m: cannot install nope: .*\/nope\/install\.(sh|ps1) is not on the site; m was not installed/);
        assert.deepStrictEqual(order(p5), ['c'], 'the dependency before it stays installed; m is not');
        app('f', { fail: true });
        app('n', { requires: [{ slug: 'f', min: '1.0.0' }] });
        const p6 = prefix();
        r = await install('n', p6);
        assert.notStrictEqual(r.status, 0, r.out);
        assert.match(r.out, /checksum mismatch on f/);
        assert.match(r.out, /n: installing f failed \(its reason is above\); n was not installed/);
        assert.deepStrictEqual(order(p6), [], r.out);
      } finally {
        await site.close();
      }
    });
}

test('the reference PowerShell installer, run as `irm | iex`, leaves the session\'s environment as it found it', { skip: !HAS_PWSH && 'pwsh not on PATH' }, async () => {
  const m = await load();
  const base = tmp('pd-iex-');
  const I = INSTALLERS.ps1;
  const site = await serve(base);
  try {
    for (const [slug, requires] of [['a', [{ slug: 'b', min: '1.0.0' }]], ['b', []]]) {
      const [appLine, versionFn, installFn] = I.make(slug, '1.0.0', false);
      const text = once(once(once(I.block(), I.app, appLine), I.fns[0], versionFn), I.fns[1], installFn)
        .split(m.REQUIRES_PLACEHOLDER).join(m.requiresStamp({ requires }));
      fs.mkdirSync(path.join(base, slug));
      fs.writeFileSync(path.join(base, slug, I.file), text);
    }
    const p = tmp('pd-prefix-');
    const probe = "foreach ($k in 'INSTALL_REQUIRES_CHAIN','INSTALL_REQUIRES_DONE','INSTALL_MIN') { Write-Output \"$k=[$([Environment]::GetEnvironmentVariable($k))]\" }; Write-Output \"SITE=[$env:DOWNLOADS_SITE]\"";
    const r = await runInstaller('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `irm ${site.url}/a/install.ps1 | iex; ${probe}`], { DOWNLOADS_SITE: site.url, PREFIX: p });
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(fs.readFileSync(path.join(p, 'order'), 'utf8').trim().split(/\r?\n/), ['b', 'a']);
    assert.match(r.out, /INSTALL_REQUIRES_CHAIN=\[\]\s+INSTALL_REQUIRES_DONE=\[\]\s+INSTALL_MIN=\[\]\s+SITE=\[http:\/\/127\.0\.0\.1:\d+\]/);
  } finally {
    await site.close();
  }
});

// ── portal fields (#655) ─────────────────────────────────────────────────────────────────────────

/** The first bytes of a PNG of w×h: what the script reads (signature, IHDR). */
function png(w, h, pad = 0) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(pad)]);
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const PORTAL = {
  ...MANIFEST,
  description: { en: 'Probe watches **one** thing.\n\n- fast\n- small\n\nSee [the guide](https://example.invalid/guide).', vi: 'Probe theo dõi *một* thứ.' },
  icon: 'media/icon.png',
  screenshots: [
    { file: 'media/main.png', alt: 'The main window', caption: { en: 'Main', vi: 'Chính' }, theme: 'light' },
    { file: 'media/dark.jpg', alt: 'The main window, dark', theme: 'dark' },
  ],
  examples: [{ caption: 'Check a host', command: 'probe check example.invalid', output: 'ok  12 ms\n' }, { caption: 'Version', command: 'probe --version' }],
  install: {
    ...MANIFEST.install,
    prompt: { en: 'Install Probe from <site>/probe — read <site>/probe/manifest.json and follow it.' },
    handover: ['Open Probe and sign in to <site>'],
  },
  listed: false,
};

/** The fixture with PORTAL's manifest and its image files beside it (`images` overrides a file's bytes). */
function portalFixture({ manifest = PORTAL, images = {} } = {}) {
  const fx = fixture({ manifest });
  const dir = path.join(fx.repo, '.github', 'downloads', 'media');
  fs.mkdirSync(dir, { recursive: true });
  const files = { 'icon.png': png(256, 256), 'main.png': png(1280, 800), 'dark.jpg': JPEG, ...images };
  for (const [n, b] of Object.entries(files)) if (b !== null) fs.writeFileSync(path.join(dir, n), b);
  return fx;
}

test('portal fields: all optional, each shape-checked, every problem named', async () => {
  const m = await load();
  assert.doesNotThrow(() => m.validateManifest(MANIFEST), 'a manifest without them stays valid');
  assert.doesNotThrow(() => m.validateManifest(PORTAL));
  assert.doesNotThrow(() => m.validateManifest({ ...PORTAL, icon: 'brand/icon.svg', listed: true }));
  const bad = (patch, ...want) => assert.throws(() => m.validateManifest({ ...PORTAL, ...patch }),
    (e) => want.every((w) => w.test(e.message)) || assert.fail(e.message));
  bad({ description: '<b>hi</b>' }, /description: raw HTML/);
  bad({ description: { en: '# Title\n\n![x](https://a/b.png)', vi: '```\ncode\n```' } },
    /description\.en: no headings/, /description\.en: no inline images/, /description\.vi: no code blocks/);
  bad({ description: 'see [it](http://plain.invalid)' }, /the link "http:\/\/plain\.invalid" is not an https/);
  bad({ description: 'x'.repeat(2001) }, /longer than 2000/);
  bad({ icon: '../icon.png' }, /icon: "\.\.\/icon\.png" is not a path inside/);
  bad({ icon: 'icon.jpg' }, /icon: "icon\.jpg" is not a \.png \/ \.svg file/);
  bad({ screenshots: Array(7).fill(PORTAL.screenshots[0]) }, /screenshots: a list of at most 6/);
  bad({ screenshots: [{ file: 'a.gif', alt: '', theme: 'sepia', zoom: 2 }] },
    /screenshots\[0\]\.zoom: unknown/, /screenshots\[0\]\.file: "a\.gif"/, /screenshots\[0\]\.alt: a one-line text is required/, /screenshots\[0\]\.theme/);
  bad({ examples: [{ command: 'a\nb', output: Array(12).fill('line').join('\n') }] },
    /examples\[0\]\.caption/, /examples\[0\]\.command: one line/, /examples\[0\]\.output: more than 10 lines/);
  bad({ examples: Array(7).fill(PORTAL.examples[1]) }, /examples: a list of at most 6/);
  bad({ install: { prompt: 'x', handover: [] } }, /install: an object keyed by platform/);
  bad({ install: { ...PORTAL.install, prompt: '', handover: [] } }, /install\.prompt: a text/, /install\.handover: a non-empty list/);
  bad({ listed: 'no' }, /listed: true or false/);
});

test('portal fields: the image files are checked when the repo is loaded, and `check` says so', async () => {
  const m = await load();
  const ok = portalFixture();
  assert.doesNotThrow(() => m.loadRepo(ok.repo));
  const c = spawnSync(process.execPath, [SCRIPT, 'check', '--root', ok.repo], { encoding: 'utf8' });
  assert.strictEqual(c.status, 0, c.stderr);
  assert.match(c.stdout, /valid, 3 image\(s\), unlisted$/m);
  const refuses = (opts, re) => assert.throws(() => m.loadRepo(portalFixture(opts).repo), re);
  refuses({ images: { 'main.png': null } }, /screenshots\[0\]\.file media\/main\.png: no such file next to \.github\/downloads\/manifest\.json/);
  refuses({ images: { 'main.png': png(1280, 800, 1024 * 1024) } }, /media\/main\.png: \d+ bytes, over the 1048576-byte limit/);
  refuses({ images: { 'dark.jpg': png(10, 10) } }, /media\/dark\.jpg: its bytes are a png, not the jpeg its name says/);
  refuses({ images: { 'main.png': Buffer.from('not an image') } }, /its bytes are not an image/);
  refuses({ images: { 'icon.png': png(256, 128) } }, /icon media\/icon\.png: 256×128, an icon is square/);
  const svg = (vb) => Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"${vb}><rect/></svg>`);
  const svgIcon = { ...PORTAL, icon: 'media/icon.svg' };
  assert.doesNotThrow(() => m.loadRepo(portalFixture({ manifest: svgIcon, images: { 'icon.svg': svg(' viewBox="0 0 64 64"') } }).repo));
  refuses({ manifest: svgIcon, images: { 'icon.svg': svg('') } }, /an SVG icon needs a viewBox/);
  refuses({ manifest: svgIcon, images: { 'icon.svg': svg(' viewBox="0 0 64 32"') } }, /64×32, an icon is square/);
  const twins = { ...PORTAL, screenshots: [...PORTAL.screenshots, { file: 'other/main.png', alt: 'x' }] };
  const fx = portalFixture({ manifest: twins });
  fs.mkdirSync(path.join(fx.repo, '.github', 'downloads', 'other'));
  fs.writeFileSync(path.join(fx.repo, '.github', 'downloads', 'other', 'main.png'), png(10, 10));
  assert.throws(() => m.loadRepo(fx.repo), /another image is also named main\.png/);
});

test('portal fields: images go in the version folder and SHA256SUMS, not latest.json; the site\'s manifest names them there', async () => {
  const m = await load();
  const fx = portalFixture();
  const { config, manifest } = m.loadRepo(fx.repo);
  const outDir = tmp('pd-out-');
  const staged = await m.stage({ tag: 'v1.2.0', assetsDir: fx.assets, outDir, baseUrl: BASE, root: fx.repo, config, manifest });
  assert.deepStrictEqual(fs.readdirSync(path.join(outDir, '1.2.0')).sort(),
    ['Probe_1.2.0_x64.dmg', 'SHA256SUMS', 'dark.jpg', 'icon.png', 'main.png', 'probe-1.2.0.tgz']);
  assert.deepStrictEqual(Object.keys(m.parseSums(Buffer.from(staged.sums))).sort(),
    ['Probe_1.2.0_x64.dmg', 'dark.jpg', 'icon.png', 'main.png', 'probe-1.2.0.tgz']);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(outDir, 'latest.json'), 'utf8')).files).sort(),
    ['Probe_1.2.0_x64.dmg', 'probe-1.2.0.tgz'], 'latest.json lists what an installer downloads, no images');
  const site = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.strictEqual(site.icon, '1.2.0/icon.png');
  assert.deepStrictEqual(site.screenshots.map((s) => s.file), ['1.2.0/main.png', '1.2.0/dark.jpg']);
  assert.strictEqual(site.screenshots[0].alt, 'The main window');
  assert.strictEqual(site.install.prompt.en, `Install Probe from ${BASE}/probe — read ${BASE}/probe/manifest.json and follow it.`);
  assert.deepStrictEqual(site.install.handover, [`Open Probe and sign in to ${BASE}`]);
  assert.strictEqual(site.listed, false);
  assert.doesNotThrow(() => m.validateManifest(site), 'the site\'s copy is itself a valid manifest (checkRequires reads it)');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.repo, '.github', 'downloads', 'manifest.json'), 'utf8')).icon,
    'media/icon.png', 'the repo\'s manifest is not changed');
  // an image with a binary's name refuses
  const clash = portalFixture({ manifest: { ...PORTAL, icon: 'media/probe-1.2.0.png' }, images: { 'probe-1.2.0.png': png(8, 8) } });
  fs.writeFileSync(path.join(clash.assets, 'probe-1.2.0.png'), 'a binary');
  const cfg = m.loadRepo(clash.repo);
  await assert.rejects(m.stage({ tag: 'v1.2.0', assetsDir: clash.assets, outDir: tmp('pd-out-'), baseUrl: BASE, root: clash.repo,
    config: { ...cfg.config, optional: ['probe-{v}.png'] }, manifest: cfg.manifest }), /the image probe-1\.2\.0\.png has the name of a file of this version/);
});

test('portal fields: published and read back; a re-run is a no-op; a changed image of a published version refuses, naming it', { skip: !HAS_RSYNC && 'rsync not on PATH' }, async () => {
  const fx = portalFixture();
  const first = await run(fx);
  for (const n of ['icon.png', 'main.png', 'dark.jpg']) {
    assert.ok(first.result.uploaded.includes(`1.2.0/${n}`), `${n} read back as uploaded`);
    assert.ok(fs.readFileSync(path.join(fx.site, '1.2.0', n)).equals(fs.readFileSync(path.join(fx.repo, '.github', 'downloads', 'media', n))));
  }
  assert.match(fs.readFileSync(path.join(fx.site, '1.2.0', 'SHA256SUMS'), 'utf8'), /  icon\.png\n/);
  const again = await run(fx);
  assert.deepStrictEqual(again.calls, [], 'a re-run with the same images calls rsync zero times');
  fs.writeFileSync(path.join(fx.repo, '.github', 'downloads', 'media', 'main.png'), png(1280, 801));
  await assert.rejects(run(fx), /already published and its SHA256SUMS differs from this build's \(main\.png\).*only images differ: publish from the tag/);
  fs.writeFileSync(path.join(fx.assets, 'probe-1.2.0.tgz'), 'rebuilt');
  await assert.rejects(run(fx), /\(main\.png, probe-1\.2\.0\.tgz\).*publish a new version instead/);
});
