'use strict';
/**
 * templates/deploy-container-run.mjs + templates/deploy-adapter-portainer.mjs (#452), hermetic.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * A fake Portainer (node:http, in this process) encodes what was measured on Portainer CE 2.45.1:
 * redeploy is asynchronous (Status 3 → 1), ConfigHash is the deployed commit, 409 while busy, 500 on
 * a missing tag, Env replaced wholesale, and a 200 that can still be refused by the environment. The
 * same server answers the version URL from whatever the stack is running. `run()` is driven in
 * process with `sh` stubbed (git / docker / gh / the pre-deploy hook), so nothing real is built,
 * pushed or deployed; one test runs the CLI end to end with stub binaries on PATH.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUN = path.join(REPO_ROOT, 'templates', 'deploy-container-run.mjs');
const ADAPTER = path.join(REPO_ROOT, 'templates', 'deploy-adapter-portainer.mjs');
const load = (p) => import(require('url').pathToFileURL(p).href);

const SHA = { 'v1.2.2': 'a'.repeat(40), 'v1.2.3': 'b'.repeat(40), 'v1.2.1': 'c'.repeat(40) };
const IMG = 'registry.example.com/team/web';
const IMG2 = 'registry.example.com/team/form';

/** A fake Portainer plus a version endpoint at /version. */
function fakePortainer(opts = {}) {
  const st = {
    kind: opts.kind || 'git',
    stack: {
      Id: 5, Name: 'shop', Status: 1,
      GitConfig: opts.kind === 'file' ? null : { ReferenceName: opts.ref || 'refs/tags/v1.2.2', ConfigHash: SHA['v1.2.2'], Authentication: null },
      Env: opts.env || [{ name: 'DB_HOST', value: 'db' }, { name: 'IMAGE_TAG', value: 'v1.2.2' }, { name: 'MODE', value: 'prod' }],
    },
    file: 'services: {}\n',
    images: opts.images || [IMG],
    running: 'v1.2.2',
    requests: [],
    puts: [],
    putStatuses: [...(opts.putStatuses || [])], // consumed first, then 200 / 500 by tag
    deployingPolls: opts.deployingPolls === undefined ? 2 : opts.deployingPolls,
    pending: 0,
    refuse: opts.refuse || null, // 'containers' | 'hash' | (tag => bool)
    healthLag: opts.healthLag || 0,
    healthBody: opts.healthBody || ((v) => JSON.stringify({ version: v })),
    healthNever: opts.healthNever || null, // a tag whose version the endpoint never reports
    healthAuth: opts.healthAuth || null, // [header-name, expected value]: /version is 401 without it
  };
  st.containers = () => st.images.map((ref) => ({ Image: `${ref}:${st.running}`, State: 'running' }));
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const json = body ? JSON.parse(body) : null;
      st.requests.push({ method: req.method, path: u.pathname, query: u.search, key: req.headers['x-api-key'], headers: req.headers, body: json });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      if (u.pathname === '/version') {
        if (st.healthAuth && req.headers[st.healthAuth[0]] !== st.healthAuth[1]) return send(401, { message: 'unauthorized' });
        if (st.healthLag > 0) { st.healthLag--; return send(200, st.healthBody('1.2.2')); }
        if (st.healthNever && st.running === st.healthNever) return send(200, st.healthBody('0.0.0'));
        return send(200, st.healthBody(st.running.slice(1)));
      }
      if (req.method === 'GET' && u.pathname === '/api/stacks/5') {
        if (st.stack.Status === 3 && st.pending-- <= 0) st.stack.Status = 1;
        return send(200, st.stack);
      }
      if (req.method === 'GET' && u.pathname === '/api/stacks/5/file') return send(200, { StackFileContent: st.file });
      if (req.method === 'GET' && u.pathname === '/api/endpoints/2/docker/containers/json') {
        return send(200, st.stack.Status === 3 ? [] : st.containers());
      }
      if (req.method === 'PUT' && (u.pathname === '/api/stacks/5/git/redeploy' || u.pathname === '/api/stacks/5')) {
        st.puts.push({ path: u.pathname, query: u.search, body: json });
        const forced = st.putStatuses.shift();
        if (forced === 409) { st.stack.Status = 3; st.pending = 1; return send(409, { message: 'Stack deployment is already in progress' }); }
        if (forced) return send(forced, { message: 'forced' });
        const envTag = (json.Env.find((e) => e.name === 'IMAGE_TAG') || {}).value;
        const ref = json.RepositoryReferenceName;
        const tag = ref ? ref.replace('refs/tags/', '') : envTag;
        if (ref && !SHA[tag]) return send(500, { message: "Unable to clone git repository: couldn't find remote ref" });
        st.stack.Status = 3;
        st.pending = st.deployingPolls;
        st.stack.Env = json.Env;
        if (st.stack.GitConfig) {
          st.stack.GitConfig.ReferenceName = ref;
          st.stack.GitConfig.ConfigHash = st.refuse === 'hash' ? SHA['v1.2.1'] : SHA[tag];
        }
        if (json.StackFileContent !== undefined) st.file = json.StackFileContent;
        const refused = typeof st.refuse === 'function' ? st.refuse(tag) : st.refuse === 'containers';
        if (!refused) st.running = envTag;
        return send(200, st.stack);
      }
      send(404, { message: `no route ${req.method} ${u.pathname}` });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    st.url = `http://127.0.0.1:${server.address().port}`;
    st.close = () => new Promise((r) => server.close(r));
    resolve(st);
  }));
}

const TIMING = { pollMs: 5, deployTimeoutS: 2, busyTimeoutS: 2, verifyTimeoutS: 1 };

function envFor(st, extra = {}) {
  return {
    PORTAINER_URL: st.url, PORTAINER_ENDPOINT_ID: '2', PORTAINER_STACK_ID: '5', PORTAINER_API_KEY: 'k-123',
    PORTAINER_STACK_KIND: st.kind, DEPLOY_IMAGES: `${IMG} .\n`, HEALTH_URL: `${st.url}/version`,
    GITHUB_REPOSITORY: 'owner/app',
    ...extra,
  };
}

/** `gh issue list --json number,body` output: issue 9 is the release record for v1.2.3. */
const RECORD_9 = JSON.stringify([{ number: 9, body: '<!-- colab:release version=v1.2.3 -->\n# release: v1.2.3' }]);

/** An io whose `sh` is a recorder: git resolves tags from SHA, docker succeeds, gh finds issue 9. */
function ioFor(env, { manifests = [], hookExit = 0, files = {}, issues = RECORD_9 } = {}) {
  const calls = [];
  const out = [];
  const io = {
    env, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
    log: (m) => out.push(m), error: (m) => out.push(`::error::${m}`), summary: (l) => out.push(`SUMMARY ${l}`),
    readFile: (p) => (p in files ? files[p] : null), timing: TIMING, calls, out,
    sh: (cmd, args, opts = {}) => {
      calls.push({ cmd, args, env: opts.env });
      if (cmd === 'git' && args[0] === 'rev-parse') return { status: 0, stdout: `${SHA[args[1].replace('^{commit}', '')] || ''}\n`, stderr: '' };
      if (cmd === 'git' && args[0] === 'tag') return { status: 0, stdout: 'v1.2.1\nv1.2.2\nv1.2.3-rc.1\nv1.2.3\n', stderr: '' };
      if (cmd === 'docker' && args[0] === 'manifest') return { status: manifests.includes(args[2]) ? 0 : 1, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[1] === 'list') return { status: 0, stdout: `${issues}\n`, stderr: '' };
      if (cmd === 'sh') return { status: hookExit, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  };
  return io;
}

const ghComments = (io) => io.calls.filter((c) => c.cmd === 'gh' && c.args[1] === 'comment').map((c) => c.args[c.args.indexOf('--body') + 1]);

// ---- the adapter ----------------------------------------------------------------------------------

test('portainer git stack: PUT /api/stacks/{id}/git/redeploy?endpointId=N, refs/tags/vX.Y.Z, Env carries IMAGE_TAG, PullImage, Prune, X-API-Key', async () => {
  const st = await fakePortainer();
  try {
    const a = await load(ADAPTER);
    const cfg = a.configFromEnv(envFor(st));
    await a.deploy(cfg, { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING });
    assert.equal(st.puts.length, 1);
    const p = st.puts[0];
    assert.equal(p.path, '/api/stacks/5/git/redeploy');
    assert.equal(p.query, '?endpointId=2');
    assert.equal(p.body.RepositoryReferenceName, 'refs/tags/v1.2.3');
    assert.equal(p.body.PullImage, true);
    assert.equal(p.body.Prune, true);
    assert.deepEqual(p.body.Env.find((e) => e.name === 'IMAGE_TAG'), { name: 'IMAGE_TAG', value: 'v1.2.3' });
    assert.ok(st.requests.every((r) => r.path === '/version' || r.key === 'k-123'), 'every API call carries X-API-Key');
  } finally { await st.close(); }
});

test('portainer file stack: PUT /api/stacks/{id}?endpointId=N with StackFileContent + Env', async () => {
  const st = await fakePortainer({ kind: 'file' });
  try {
    const a = await load(ADAPTER);
    const cfg = a.configFromEnv(envFor(st));
    await a.deploy(cfg, { tag: 'v1.2.3', images: [IMG], fileContent: 'services:\n  web: {}\n' }, { ...ioFor({}), timing: TIMING });
    const p = st.puts[0];
    assert.equal(p.path, '/api/stacks/5');
    assert.equal(p.query, '?endpointId=2');
    assert.equal(p.body.StackFileContent, 'services:\n  web: {}\n');
    assert.equal(p.body.PullImage, true);
    assert.equal(p.body.Prune, true);
    assert.equal(p.body.RepositoryReferenceName, undefined);
    assert.deepEqual(p.body.Env.find((e) => e.name === 'IMAGE_TAG'), { name: 'IMAGE_TAG', value: 'v1.2.3' });
  } finally { await st.close(); }
});

test('Env is the full current list with IMAGE_TAG replaced, never only the changed key', async () => {
  const a = await load(ADAPTER);
  assert.deepEqual(a.mergeEnv([{ name: 'A', value: '1' }, { name: 'IMAGE_TAG', value: 'v1' }, { name: 'B', value: '2' }], { IMAGE_TAG: 'v2' }),
    [{ name: 'A', value: '1' }, { name: 'IMAGE_TAG', value: 'v2' }, { name: 'B', value: '2' }]);
  assert.deepEqual(a.mergeEnv([{ name: 'A', value: '1' }], { IMAGE_TAG: 'v2' }), [{ name: 'A', value: '1' }, { name: 'IMAGE_TAG', value: 'v2' }]);
  const st = await fakePortainer();
  try {
    await a.deploy(a.configFromEnv(envFor(st)), { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING });
    assert.deepEqual(st.puts[0].body.Env, [{ name: 'DB_HOST', value: 'db' }, { name: 'IMAGE_TAG', value: 'v1.2.3' }, { name: 'MODE', value: 'prod' }]);
  } finally { await st.close(); }
});

test('Status 3 → 1 is polled; ConfigHash must equal the tag commit', async () => {
  const a = await load(ADAPTER);
  const st = await fakePortainer({ deployingPolls: 3 });
  try {
    await a.deploy(a.configFromEnv(envFor(st)), { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING });
    const gets = st.requests.filter((r) => r.method === 'GET' && r.path === '/api/stacks/5');
    assert.ok(gets.length >= 4, `polled while deploying (${gets.length} GETs)`);
  } finally { await st.close(); }
  const bad = await fakePortainer({ refuse: 'hash' });
  try {
    await assert.rejects(
      a.deploy(a.configFromEnv(envFor(bad)), { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING }),
      (e) => e.kind === 'refused' && e.changed === true && /runs commit c{40}, not v1\.2\.3/.test(e.message),
    );
  } finally { await bad.close(); }
});

test('409 is waited out and retried', async () => {
  const a = await load(ADAPTER);
  const st = await fakePortainer({ putStatuses: [409] });
  try {
    await a.deploy(a.configFromEnv(envFor(st)), { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING });
    assert.equal(st.puts.length, 2);
    assert.equal(st.running, 'v1.2.3');
  } finally { await st.close(); }
});

test('500 fails at once — nothing changed', async () => {
  const a = await load(ADAPTER);
  const st = await fakePortainer();
  try {
    await assert.rejects(
      a.deploy(a.configFromEnv(envFor(st)), { tag: 'v9.9.9', tagSha: 'f'.repeat(40), images: [IMG] }, { ...ioFor({}), timing: TIMING }),
      (e) => e.kind === 'hard' && e.changed === false && /answered 500/.test(e.message),
    );
    assert.equal(st.puts.length, 1);
  } finally { await st.close(); }
});

test('200 but refused (containers not on the new image) fails', async () => {
  const a = await load(ADAPTER);
  const st = await fakePortainer({ refuse: 'containers' });
  try {
    await assert.rejects(
      a.deploy(a.configFromEnv(envFor(st)), { tag: 'v1.2.3', tagSha: SHA['v1.2.3'], images: [IMG] }, { ...ioFor({}), timing: TIMING }),
      (e) => e.kind === 'refused' && e.changed === true && /not running registry\.example\.com\/team\/web:v1\.2\.3/.test(e.message),
    );
  } finally { await st.close(); }
});

test('configFromEnv names every missing key', async () => {
  const a = await load(ADAPTER);
  assert.throws(() => a.configFromEnv({ PORTAINER_URL: 'https://p.example.com' }), /missing PORTAINER_ENDPOINT_ID, PORTAINER_STACK_ID, PORTAINER_API_KEY/);
  assert.throws(() => a.configFromEnv({ PORTAINER_URL: 'u', PORTAINER_ENDPOINT_ID: '1', PORTAINER_STACK_ID: '1', PORTAINER_API_KEY: 'k', PORTAINER_STACK_KIND: 'swarm' }), /expected git or file/);
});

// ---- the driver ------------------------------------------------------------------------------------

test('a green deploy: built once, one adapter call, verified, recorded on the release issue', async () => {
  const d = await load(RUN);
  const st = await fakePortainer();
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    const docker = io.calls.filter((c) => c.cmd === 'docker').map((c) => c.args.join(' '));
    assert.deepEqual(docker, [
      `manifest inspect ${IMG}:v1.2.3`,
      `build -f ./Dockerfile -t ${IMG}:v1.2.3 -t ${IMG}:${SHA['v1.2.3']} .`,
      `push ${IMG}:v1.2.3`,
      `push ${IMG}:${SHA['v1.2.3']}`,
    ]);
    assert.equal(st.puts.length, 1);
    const [c] = ghComments(io);
    assert.match(c, /^running v1\.2\.3 at \d{4}-\d\d-\d\dT/);
    assert.ok(io.calls.some((x) => x.cmd === 'gh' && x.args.includes('"colab:release version=v1.2.3" in:body')));
  } finally { await st.close(); }
});

// ---- the release record is a body that STARTS with the marker (#576) ----------------------------

test('an issue that only MENTIONS the marker mid-body gets no comment — the line stays in the run summary', async () => {
  const d = await load(RUN);
  const st = await fakePortainer();
  try {
    const mention = JSON.stringify([{ number: 4, body: 'Discussing how `<!-- colab:release version=v1.2.3 -->` is matched.' }]);
    const io = ioFor(envFor(st), { issues: mention });
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    assert.deepEqual(ghComments(io), []);
    assert.ok(io.out.some((l) => /^SUMMARY running v1\.2\.3 at /.test(l)), io.out.join('\n'));
    assert.ok(io.out.includes('no release issue for v1.2.3 — recorded in the run summary only'), io.out.join('\n'));
  } finally { await st.close(); }
});

test('an issue that STARTS with the marker gets the comment, even when a mentioning issue ranks first', async () => {
  const d = await load(RUN);
  const st = await fakePortainer();
  try {
    const both = JSON.stringify([
      { number: 4, body: 'See <!-- colab:release version=v1.2.3 --> for the record.' },
      { number: 7, body: '<!-- colab:release version=v1.2.30 -->' },
      { number: 12, body: '\n  <!-- colab:release version=v1.2.3 -->\n# release: v1.2.3' },
    ]);
    const io = ioFor(envFor(st), { issues: both });
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    const comments = io.calls.filter((c) => c.cmd === 'gh' && c.args[1] === 'comment');
    assert.equal(comments.length, 1);
    assert.equal(comments[0].args[2], '12');
    assert.match(ghComments(io)[0], /^running v1\.2\.3 at /);
  } finally { await st.close(); }
});

test('releaseIssue: anchored, exact version, and empty on unparseable output', async () => {
  const d = await load(RUN);
  assert.equal(d.releaseIssue(RECORD_9, 'v1.2.3'), '9');
  assert.equal(d.releaseIssue(RECORD_9, 'v1.2.4'), '');
  assert.equal(d.releaseIssue(JSON.stringify([{ number: 3, body: 'x <!-- colab:release version=v1.2.3 -->' }]), 'v1.2.3'), '');
  assert.equal(d.releaseIssue('not json', 'v1.2.3'), '');
  assert.equal(d.releaseIssue('', 'v1.2.3'), '');
});

test('two images are built once each and deployed in one adapter call', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ images: [IMG, IMG2] });
  try {
    const io = ioFor(envFor(st, { DEPLOY_IMAGES: `# web + form handler\n${IMG} web\n${IMG2} form form/Dockerfile.prod\n` }));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    const docker = io.calls.filter((c) => c.cmd === 'docker');
    assert.equal(docker.filter((c) => c.args[0] === 'build').length, 2);
    assert.equal(docker.filter((c) => c.args[0] === 'push').length, 4);
    assert.ok(docker.some((c) => c.args.join(' ') === `build -f form/Dockerfile.prod -t ${IMG2}:v1.2.3 -t ${IMG2}:${SHA['v1.2.3']} form`));
    assert.equal(st.puts.length, 1);
  } finally { await st.close(); }
});

test('an image already pushed for the tag is not rebuilt', async () => {
  const d = await load(RUN);
  const st = await fakePortainer();
  try {
    const io = ioFor(envFor(st), { manifests: [`${IMG}:v1.2.3`] });
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    assert.deepEqual(io.calls.filter((c) => c.cmd === 'docker').map((c) => c.args[0]), ['manifest']);
  } finally { await st.close(); }
});

test('a failing pre-deploy hook stops the run before any adapter request', async () => {
  const d = await load(RUN);
  const st = await fakePortainer();
  try {
    const io = ioFor(envFor(st, { PRE_DEPLOY: 'sh scripts/snapshot-db.sh' }), { hookExit: 3 });
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.equal(st.requests.length, 0, 'the platform was never called');
    const hook = io.calls.find((c) => c.cmd === 'sh');
    assert.equal(hook.env.TAG, 'v1.2.3');
    assert.equal(hook.env.PREVIOUS_TAG, 'v1.2.2');
    assert.match(io.out.join('\n'), /::error::pre-deploy hook failed \(exit 3\)/);
  } finally { await st.close(); }
});

test('verify waits for the version', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ healthLag: 4 });
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    assert.ok(st.requests.filter((r) => r.path === '/version').length >= 5);
  } finally { await st.close(); }
});

test('verify fails loudly at the timeout, then rolls back to what ran before', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ healthNever: 'v1.2.3' });
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    const out = io.out.join('\n');
    assert.match(out, /::error::deploy of v1\.2\.3 failed at .*did not report 1\.2\.3 within 1s; rolled back to v1\.2\.2 \(verified\)/);
    assert.equal(st.running, 'v1.2.2');
  } finally { await st.close(); }
});

test('rollback redeploys the previous tag', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ refuse: (tag) => tag === 'v1.2.3' });
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.equal(st.puts.length, 2);
    assert.equal(st.puts[1].body.RepositoryReferenceName, 'refs/tags/v1.2.2');
    assert.deepEqual(st.puts[1].body.Env, [{ name: 'DB_HOST', value: 'db' }, { name: 'IMAGE_TAG', value: 'v1.2.2' }, { name: 'MODE', value: 'prod' }]);
    assert.match(ghComments(io)[0], /deploy of v1\.2\.3 failed .*rolled back to v1\.2\.2 \(verified\)/);
  } finally { await st.close(); }
});

test('rollback falls back to the previous final tag when the stack ran a branch', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ ref: 'refs/heads/main', env: [{ name: 'MODE', value: 'prod' }], refuse: (tag) => tag === 'v1.2.3' });
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.equal(st.puts[1].body.RepositoryReferenceName, 'refs/tags/v1.2.2');
    assert.deepEqual(st.puts[1].body.Env, [{ name: 'MODE', value: 'prod' }, { name: 'IMAGE_TAG', value: 'v1.2.2' }]);
  } finally { await st.close(); }
});

test('500 from the platform: no rollback, the run fails', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ putStatuses: [500] });
  try {
    const io = ioFor(envFor(st));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.equal(st.puts.length, 1, 'no rollback PUT — nothing changed');
    assert.match(io.out.join('\n'), /::error::PUT \/api\/stacks\/5\/git\/redeploy answered 500/);
  } finally { await st.close(); }
});

test('the driver refuses a non-final tag and a missing version URL before touching anything', async () => {
  const d = await load(RUN);
  const io1 = ioFor({ DEPLOY_IMAGES: `${IMG} .` });
  assert.equal(await d.run({ tag: 'v1.2.3-rc.1' }, io1), 1);
  assert.match(io1.out.join('\n'), /not a final tag/);
  const io2 = ioFor({ DEPLOY_IMAGES: `${IMG} .` });
  assert.equal(await d.run({ tag: 'v1.2.3' }, io2), 1);
  assert.match(io2.out.join('\n'), /no version URL/);
  assert.equal(io1.calls.length + io2.calls.length, 0);
});

test('helpers: reportsVersion is boundary-aware, readHealthUrl, previousFinalTag, parseImages', async () => {
  const d = await load(RUN);
  assert.ok(d.reportsVersion('{"version":"1.2.1"}', '1.2.1'));
  assert.ok(d.reportsVersion('running v1.2.1.', 'v1.2.1'));
  assert.ok(!d.reportsVersion('{"version":"1.2.10"}', '1.2.1'));
  assert.ok(!d.reportsVersion('{"version":"11.2.1"}', '1.2.1'));
  assert.ok(!d.reportsVersion('{"version":"1.2.1.4"}', '1.2.1'));
  assert.equal(d.readHealthUrl('exposure: released\nrelease:\n  route: deploy-tag\n  health-url: https://app.example.com/version # the running version\nother: 1\n'), 'https://app.example.com/version');
  assert.equal(d.readHealthUrl('release:\n  route: deploy-tag\nhealth-url: https://x.example.com\n'), null);
  assert.equal(d.previousFinalTag(['v1.2.1', 'v1.10.0', 'v1.9.9', 'v1.10.1-rc.1', 'v2.0.0'], 'v1.10.1'), 'v1.10.0');
  assert.equal(d.previousFinalTag(['v1.0.0'], 'v1.0.0'), null);
  assert.throws(() => d.parseImages('registry.example.com/team/web:v1 .'), /carries a tag/);
  assert.deepEqual(d.parseImages('localhost:5000/web ctx/\n'), [{ ref: 'localhost:5000/web', context: 'ctx/', dockerfile: 'ctx/Dockerfile' }]);
});

// ---- build args, health-URL auth, publish / deploy split (#460) --------------------------------------

test('build args: shared and per-image, ${TAG}/${VERSION}/${SHA} substituted, passed to docker build', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ images: [IMG, IMG2] });
  try {
    const io = ioFor(envFor(st, {
      DEPLOY_IMAGES: `${IMG} web\n${IMG2} form\n`,
      DEPLOY_BUILD_ARGS: `# every image\nAPP_VERSION=\${VERSION}\nBUILD_SHA=\${SHA}\n${IMG} SITE_KEY=pk_live with space\n${IMG2} APP_VERSION=form-\${TAG}\n`,
    }));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    const builds = io.calls.filter((c) => c.cmd === 'docker' && c.args[0] === 'build').map((c) => c.args);
    assert.deepEqual(builds[0], ['build', '-f', 'web/Dockerfile',
      '--build-arg', 'APP_VERSION=1.2.3', '--build-arg', `BUILD_SHA=${SHA['v1.2.3']}`, '--build-arg', 'SITE_KEY=pk_live with space',
      '-t', `${IMG}:v1.2.3`, '-t', `${IMG}:${SHA['v1.2.3']}`, 'web']);
    assert.deepEqual(builds[1].slice(3, 7), ['--build-arg', 'APP_VERSION=form-v1.2.3', '--build-arg', `BUILD_SHA=${SHA['v1.2.3']}`], 'per-image overrides shared');
  } finally { await st.close(); }
});

test('build args: no DEPLOY_BUILD_ARGS → no --build-arg; a typo or an unlisted image is refused before docker runs', async () => {
  const d = await load(RUN);
  const imgs = d.parseImages(`${IMG} .`);
  assert.deepEqual(d.parseBuildArgs('', imgs, { tag: 'v1.2.3', sha: 'x' }), { [IMG]: [] });
  assert.throws(() => d.parseBuildArgs('V=${VERSON}', imgs, { tag: 'v1.2.3', sha: 'x' }), /\$\{VERSON\} is not one of/);
  assert.throws(() => d.parseBuildArgs(`${IMG2} K=v`, imgs, { tag: 'v1.2.3', sha: 'x' }), /DEPLOY_IMAGES does not list/);
  assert.throws(() => d.parseBuildArgs(`${IMG} not-a-pair`, imgs, { tag: 'v1.2.3', sha: 'x' }), /needs KEY=VALUE/);
  const st = await fakePortainer();
  try {
    const io = ioFor(envFor(st, { DEPLOY_BUILD_ARGS: 'V=${NOPE}' }));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.equal(io.calls.filter((c) => c.cmd === 'docker').length, 0);
    assert.equal(st.requests.length, 0);
  } finally { await st.close(); }
});

test('health auth: Basic credentials reach the version URL, are masked, and never appear in the output', async () => {
  const d = await load(RUN);
  const token = Buffer.from('ops:s3cr3t-pw').toString('base64');
  const st = await fakePortainer({ healthAuth: ['authorization', `Basic ${token}`] });
  try {
    const io = ioFor(envFor(st, { HEALTH_BASIC_AUTH: 'ops:s3cr3t-pw' }));
    const masked = [];
    io.mask = (v) => masked.push(v);
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
    assert.ok(st.requests.filter((r) => r.path === '/version').every((r) => r.headers.authorization === `Basic ${token}`));
    assert.deepEqual(masked.sort(), ['ops:s3cr3t-pw', token].sort());
    const all = io.out.join('\n') + ghComments(io).join('\n');
    assert.ok(!all.includes('s3cr3t') && !all.includes(token), 'the credential is never printed');
  } finally { await st.close(); }
});

test('health auth: a header from a secret is sent; without it a 401 never verifies', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ healthAuth: ['x-health-token', 'tok-9'] });
  try {
    const io = ioFor(envFor(st, { HEALTH_AUTH_HEADER: 'X-Health-Token: tok-9' }));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 0, io.out.join('\n'));
  } finally { await st.close(); }
  const st2 = await fakePortainer({ healthAuth: ['x-health-token', 'tok-9'] });
  try {
    const io = ioFor(envFor(st2));
    assert.equal(await d.run({ tag: 'v1.2.3' }, io), 1);
    assert.match(io.out.join('\n'), /did not report 1\.2\.3/);
  } finally { await st2.close(); }
  assert.throws(() => d.healthAuth({ HEALTH_AUTH_HEADER: 'X: y', HEALTH_BASIC_AUTH: 'a:b' }), /not both/);
  assert.throws(() => d.healthAuth({ HEALTH_BASIC_AUTH: 'nocolon' }), /user:password/);
  assert.throws(() => d.healthAuth({ HEALTH_AUTH_HEADER: 'no colon here' }), /Name: value/);
});

test('--publish-only builds and pushes with no platform config and no version URL, and never calls the platform', async () => {
  const d = await load(RUN);
  const io = ioFor({ DEPLOY_IMAGES: `${IMG} .\n`, DEPLOY_BUILD_ARGS: 'APP_VERSION=${VERSION}', GITHUB_REPOSITORY: 'owner/app' });
  assert.equal(await d.run({ tag: 'v1.2.3', publishOnly: true }, io), 0, io.out.join('\n'));
  const docker = io.calls.filter((c) => c.cmd === 'docker').map((c) => c.args.join(' '));
  assert.deepEqual(docker, [
    `manifest inspect ${IMG}:v1.2.3`,
    `build -f ./Dockerfile --build-arg APP_VERSION=1.2.3 -t ${IMG}:v1.2.3 -t ${IMG}:${SHA['v1.2.3']} .`,
    `push ${IMG}:v1.2.3`,
    `push ${IMG}:${SHA['v1.2.3']}`,
  ]);
  assert.match(io.out.join('\n'), /SUMMARY published v1\.2\.3 at /);
  assert.ok(!io.calls.some((c) => c.cmd === 'sh' || (c.cmd === 'git' && c.args[0] === 'tag')), 'no hook, no rollback lookup');
  assert.deepEqual(ghComments(io), [], 'publishing is not a deploy outcome — the release issue is untouched');
  // Already pushed → nothing rebuilt, still 0 (a re-run of the publish job is a no-op).
  const again = ioFor({ DEPLOY_IMAGES: `${IMG} .\n` }, { manifests: [`${IMG}:v1.2.3`] });
  assert.equal(await d.run({ tag: 'v1.2.3', publishOnly: true }, again), 0);
  assert.deepEqual(again.calls.filter((c) => c.cmd === 'docker').map((c) => c.args[0]), ['manifest']);
  // Still finals only.
  const rc = ioFor({ DEPLOY_IMAGES: `${IMG} .\n` });
  assert.equal(await d.run({ tag: 'v1.2.3-rc.1', publishOnly: true }, rc), 1);
  assert.equal(rc.calls.length, 0);
});

test('--deploy-only never builds: a missing image fails before the platform; present images deploy and verify', async () => {
  const d = await load(RUN);
  const st = await fakePortainer({ images: [IMG, IMG2] });
  try {
    const env = envFor(st, { DEPLOY_IMAGES: `${IMG} web\n${IMG2} form\n` });
    const io = ioFor(env, { manifests: [`${IMG}:v1.2.3`] });
    assert.equal(await d.run({ tag: 'v1.2.3', deployOnly: true }, io), 1);
    assert.equal(st.requests.length, 0, 'the platform was never called');
    assert.ok(!io.calls.some((c) => c.cmd === 'docker' && c.args[0] !== 'manifest'), 'nothing built or pushed');
    assert.match(io.out.join('\n'), new RegExp(`::error::not in the registry: ${IMG2.replace(/\./g, '\\.')}:v1\\.2\\.3`));
    const ok = ioFor(env, { manifests: [`${IMG}:v1.2.3`, `${IMG2}:v1.2.3`] });
    assert.equal(await d.run({ tag: 'v1.2.3', deployOnly: true }, ok), 0, ok.out.join('\n'));
    assert.deepEqual([...new Set(ok.calls.filter((c) => c.cmd === 'docker').map((c) => c.args[0]))], ['manifest']);
    assert.equal(st.running, 'v1.2.3');
  } finally { await st.close(); }
  const both = ioFor({ DEPLOY_IMAGES: `${IMG} .` });
  assert.equal(await d.run({ tag: 'v1.2.3', publishOnly: true, deployOnly: true }, both), 1);
  assert.deepEqual(d.parseArgs(['--tag', 'v1.2.3', '--publish-only']), { tag: 'v1.2.3', publishOnly: true });
  assert.deepEqual(d.parseArgs(['--deploy-only', '--tag=v1.2.3']), { deployOnly: true, tag: 'v1.2.3' });
});

// ---- the CLI, end to end ---------------------------------------------------------------------------

test('CLI: the copied pair runs end to end with stub git/docker/gh on PATH', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-container-'));
  const bin = path.join(dir, 'bin');
  const deployDir = path.join(dir, '.github', 'deploy');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(deployDir, { recursive: true });
  fs.copyFileSync(RUN, path.join(deployDir, 'deploy-container-run.mjs'));
  fs.copyFileSync(ADAPTER, path.join(deployDir, 'deploy-adapter-portainer.mjs'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'release:\n  route: deploy-tag\n  health-url: PLACEHOLDER\n');
  const log = path.join(dir, 'calls.log');
  const stub = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  stub('git', `case "$1" in rev-parse) echo ${SHA['v1.2.3']} ;; tag) printf 'v1.2.2\\nv1.2.3\\n' ;; esac`);
  stub('docker', 'case "$1" in manifest) exit 1 ;; esac');
  stub('gh', `case "$2" in list) printf '%s\\n' '${RECORD_9}' ;; esac`);
  const st = await fakePortainer();
  try {
    // release.health-url read from project.yml — the push/dispatch path, where no input carries it.
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), `release:\n  route: deploy-tag\n  health-url: ${st.url}/version\n`);
    const env = { ...process.env, ...envFor(st), HEALTH_URL: '', PATH: `${bin}:${process.env.PATH}`, POLL_INTERVAL_MS: '5', VERIFY_TIMEOUT_SECONDS: '2', GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') };
    const child = spawn(process.execPath, [path.join(deployDir, 'deploy-container-run.mjs'), '--tag', 'v1.2.3'], { cwd: dir, env });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const code = await new Promise((r) => child.on('close', r));
    assert.equal(code, 0, out);
    assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /^running v1\.2\.3 at /m);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /docker build -f \.\/Dockerfile -t registry\.example\.com\/team\/web:v1\.2\.3/);
    assert.match(calls, /gh issue comment 9 --repo owner\/app --body running v1\.2\.3 at/);
    assert.equal(st.running, 'v1.2.3');
  } finally {
    await st.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
