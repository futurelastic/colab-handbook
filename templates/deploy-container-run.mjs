#!/usr/bin/env node
// deploy-container-run — TEMPLATE. Copy me into your repo
// (`colab template deploy-container-run.mjs --dest .github/deploy/deploy-container-run.mjs`), next
// to your platform adapter (`deploy-adapter-<platform>.mjs`, same directory), and OWN the copy.
// templates/deploy-container.yml runs it. Nothing here calls back to the handbook.
//
// THE CONTRACT (colab-handbook #452) — one deploy path for every container app, on every host:
//   1. build every listed image ONCE per final tag (tagged vX.Y.Z and the commit sha) and push it;
//   2. run the repo's pre-deploy hook — a failure stops the run before the platform is touched;
//   3. tell the platform, through the adapter, to run exactly vX.Y.Z — all images in one call;
//   4. green only when what RUNS is vX.Y.Z: the adapter checks the stack and its containers, then
//      release.health-url must report X.Y.Z;
//   5. any failure after the platform accepted the call rolls back to what ran before (the
//      previous final), verifies that, and still fails the run. A manual rollback is a re-run
//      with the previous tag.
// The outcome — "running vX.Y.Z at <time>" or the failure — goes to the run summary and, when one
// exists, to the release issue (the issue carrying `<!-- colab:release version=vX.Y.Z -->`).
//
// CONFIGURATION (env; the workflow's one env block):
//   DEPLOY_ADAPTER          portainer (default) — loads ./deploy-adapter-<name>.mjs beside this file
//   DEPLOY_IMAGES           one image per line: `<image-ref> <build-context> [<dockerfile>]`
//   DEPLOY_BUILD_ARGS       optional, one build arg per line: `KEY=VALUE` for every image, or
//                           `<image-ref> KEY=VALUE` for one. A value may use ${TAG} (vX.Y.Z),
//                           ${VERSION} (X.Y.Z) and ${SHA} (the tag's commit) — substituted here,
//                           not by a shell. Build args are baked into the image: never a secret.
//   PRE_DEPLOY              optional shell command; gets TAG and PREVIOUS_TAG in its env
//   HEALTH_URL              the version URL; else --health-url; else release.health-url in
//                           .github/project.yml
//   HEALTH_AUTH_HEADER      optional, `Name: value` sent with every version-URL request — or
//   HEALTH_BASIC_AUTH       optional, `user:password` sent as HTTP Basic. From a secret; masked
//                           in the log and never printed. Set at most one.
//   VERIFY_TIMEOUT_SECONDS  600 · POLL_INTERVAL_MS 5000 · DEPLOY_TIMEOUT_SECONDS 600 ·
//   BUSY_TIMEOUT_SECONDS    600
//   GH_TOKEN, GITHUB_REPOSITORY — to record on the release issue (optional)
//
// Usage: node deploy-container-run.mjs --tag vX.Y.Z [--health-url URL] [--tag-sha SHA]
//                                      [--publish-only | --deploy-only]
//   --publish-only  step 1 alone: build and push every image, then stop. Needs no platform
//                   configuration and no version URL — so a final publishes its images even
//                   before the platform is switched on (the workflow's ungated `publish` job).
//   --deploy-only   steps 2-5 alone: every image must already be in the registry for the tag
//                   (the `publish` job pushed it); a missing one fails before the platform is
//                   touched, never a rebuild here.
// Exit: 0 = running vX.Y.Z, verified (or, --publish-only, every image pushed) · 1 = not deployed
//       (rolled back where something changed).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FINAL_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `<ref> <context> [<dockerfile>]` per line; blank lines and `#` comments skipped. */
export function parseImages(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [ref, context, dockerfile] = line.split(/\s+/);
    if (!ref || !context) throw new Error(`DEPLOY_IMAGES line "${line}" needs <image-ref> <build-context> [<dockerfile>]`);
    if (/:[^/]*$/.test(ref.split('/').pop())) throw new Error(`DEPLOY_IMAGES ref "${ref}" carries a tag — list it without one; the tag is the release's`);
    out.push({ ref, context, dockerfile: dockerfile || `${context.replace(/\/+$/, '')}/Dockerfile` });
  }
  return out;
}

/**
 * DEPLOY_BUILD_ARGS → per-image `--build-arg` lists. `KEY=VALUE` applies to every image,
 * `<image-ref> KEY=VALUE` to that one (a later line for the same key wins, per-image over shared).
 * ${TAG} / ${VERSION} / ${SHA} are substituted; any other ${NAME} is a typo and refused.
 */
export function parseBuildArgs(text, images, release) {
  const vars = { TAG: release.tag, VERSION: String(release.tag).replace(/^v/, ''), SHA: release.sha };
  const refs = new Set(images.map((i) => i.ref));
  const shared = new Map();
  const per = new Map(images.map((i) => [i.ref, new Map()]));
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let target = null; let pair = line;
    const first = line.split(/\s+/, 1)[0];
    if (!first.includes('=')) {
      target = first;
      pair = line.slice(first.length).trim();
      if (!refs.has(target)) throw new Error(`DEPLOY_BUILD_ARGS line "${line}" names ${target}, which DEPLOY_IMAGES does not list`);
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(pair);
    if (!m) throw new Error(`DEPLOY_BUILD_ARGS line "${line}" needs KEY=VALUE or <image-ref> KEY=VALUE`);
    const value = m[2].replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`DEPLOY_BUILD_ARGS: \${${k}} is not one of \${TAG}, \${VERSION}, \${SHA}`);
      return vars[k];
    });
    (target ? per.get(target) : shared).set(m[1], value);
  }
  const out = {};
  for (const img of images) {
    const merged = new Map([...shared, ...per.get(img.ref)]);
    out[img.ref] = [...merged].flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]);
  }
  return out;
}

/** HEALTH_AUTH_HEADER / HEALTH_BASIC_AUTH → { headers, secret }; the secret is what to mask. */
export function healthAuth(env) {
  const header = (env.HEALTH_AUTH_HEADER || '').trim();
  const basic = env.HEALTH_BASIC_AUTH || '';
  if (header && basic) throw new Error('set HEALTH_AUTH_HEADER or HEALTH_BASIC_AUTH, not both');
  if (basic) {
    if (!basic.includes(':')) throw new Error('HEALTH_BASIC_AUTH must be user:password');
    const token = Buffer.from(basic, 'utf8').toString('base64');
    return { headers: { Authorization: `Basic ${token}` }, secrets: [basic, token] };
  }
  if (header) {
    const m = /^([A-Za-z0-9-]+):\s*(.+)$/.exec(header);
    if (!m) throw new Error('HEALTH_AUTH_HEADER must be "Name: value"');
    return { headers: { [m[1]]: m[2] }, secrets: [m[2]] };
  }
  return { headers: {}, secrets: [] };
}

/** Does `body` report `version` — as a whole version, so 1.2.1 never matches 1.2.10 or 11.2.1? */
export function reportsVersion(body, version) {
  const v = String(version).replace(/^v/, '').replace(/\./g, '\\.');
  return new RegExp(`(?<![0-9.])v?${v}(?![0-9]|\\.[0-9])`).test(String(body || ''));
}

/** release.health-url from a project.yml text — block style only; anything else reads as absent. */
export function readHealthUrl(text) {
  const lines = String(text || '').split('\n');
  const at = lines.findIndex((l) => /^release:\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !/^\s/.test(l)) break;
    const m = /^\s+health-url:\s*["']?([^"'\s#]+)["']?\s*(#.*)?$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

/** The newest strict final tag (vN.N.N, no pre-release) below `current`, or null. */
export function previousFinalTag(tags, current) {
  const key = (t) => { const m = FINAL_TAG.exec(t); return m ? [+m[1], +m[2], +m[3]] : null; };
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const cur = key(current);
  const older = (tags || []).map((t) => [t, key(t)]).filter(([, k]) => k && (!cur || cmp(k, cur) < 0));
  older.sort((a, b) => cmp(b[1], a[1]));
  return older.length ? older[0][0] : null;
}

export async function loadAdapter(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`DEPLOY_ADAPTER "${name}" is not an adapter name`);
  return import(new URL(`./deploy-adapter-${name}.mjs`, import.meta.url));
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', env: opts.env || process.env });
  return { status: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function defaultIo(env) {
  return {
    env,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (m) => console.log(m),
    mask: (v) => { if (env.GITHUB_ACTIONS) console.log(`::add-mask::${v}`); },
    error: (m) => console.log(`::error::${m}`),
    sh,
    summary: (line) => { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); },
    readFile: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
  };
}

async function waitForVersion(url, version, io, timeoutS, auth = {}) {
  const until = io.now() + timeoutS * 1000;
  let last = '';
  for (;;) {
    try {
      const res = await io.fetch(url, { headers: { 'Cache-Control': 'no-cache', ...auth } });
      last = await res.text();
      if (res.ok && reportsVersion(last, version)) return true;
    } catch (e) { last = String(e && e.message); }
    if (io.now() >= until) return false;
    await io.sleep(io.timing.pollMs);
  }
}

function record(io, tag, line) {
  io.summary(line);
  const repo = io.env.GITHUB_REPOSITORY;
  if (!repo) return;
  const found = io.sh('gh', ['issue', 'list', '--repo', repo, '--state', 'all', '--search', `"colab:release version=${tag}" in:body`, '--json', 'number', '--jq', '.[0].number // ""']);
  const n = found.status === 0 ? found.stdout.trim() : '';
  if (!n) { io.log(`no release issue for ${tag} — recorded in the run summary only`); return; }
  const c = io.sh('gh', ['issue', 'comment', n, '--repo', repo, '--body', line]);
  if (c.status !== 0) io.log(`could not comment on release issue #${n}: ${c.stderr.trim()}`);
}

function buildOnce(images, tag, sha, io, buildArgs = {}) {
  for (const img of images) {
    if (io.sh('docker', ['manifest', 'inspect', `${img.ref}:${tag}`]).status === 0) {
      io.log(`${img.ref}:${tag} is already pushed — built once per tag, not rebuilt`);
      continue;
    }
    const steps = [
      ['build', '-f', img.dockerfile, ...(buildArgs[img.ref] || []), '-t', `${img.ref}:${tag}`, '-t', `${img.ref}:${sha}`, img.context],
      ['push', `${img.ref}:${tag}`],
      ['push', `${img.ref}:${sha}`],
    ];
    for (const args of steps) {
      const r = io.sh('docker', args, { inherit: true });
      if (r.status !== 0) throw new Error(`docker ${args[0]} ${img.ref} failed (exit ${r.status})`);
    }
  }
}

/** The whole contract. Returns the exit code. */
export async function run(opts, io) {
  const env = io.env;
  const tag = opts.tag;
  const fail = (m) => { io.error(m); return 1; };
  if (opts.publishOnly && opts.deployOnly) return fail('--publish-only and --deploy-only together would do nothing — pass at most one');
  if (!FINAL_TAG.test(tag || '')) return fail(`"${tag}" is not a final tag vX.Y.Z — this deploys finals only`);
  const version = tag.slice(1);
  const healthUrl = opts.publishOnly ? null : opts.healthUrl || env.HEALTH_URL || readHealthUrl(io.readFile('.github/project.yml'));
  if (!opts.publishOnly && !healthUrl) return fail('no version URL — set release.health-url in .github/project.yml (or HEALTH_URL); a deploy is green only on a verified running version');

  let images; let adapter; let cfg; let auth = {};
  try {
    images = parseImages(env.DEPLOY_IMAGES);
    if (!images.length) throw new Error('DEPLOY_IMAGES lists no image — list every image this stack runs');
    if (!opts.publishOnly) {
      const a = healthAuth(env);
      for (const s of a.secrets) if (io.mask) io.mask(s);
      auth = a.headers;
      adapter = await loadAdapter(env.DEPLOY_ADAPTER || 'portainer');
      cfg = adapter.configFromEnv(env);
    }
  } catch (e) { return fail(e.message); }

  const tagSha = opts.tagSha || io.sh('git', ['rev-parse', `${tag}^{commit}`]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(tagSha)) return fail(`could not resolve ${tag} to a commit`);
  const at = () => new Date(io.now()).toISOString();

  // 1. Build once — or, --deploy-only, check the publish job left every image in the registry.
  if (opts.deployOnly) {
    const missing = images.filter((img) => io.sh('docker', ['manifest', 'inspect', `${img.ref}:${tag}`]).status !== 0).map((img) => `${img.ref}:${tag}`);
    if (missing.length) {
      const m = `not in the registry: ${missing.join(', ')} — the publish job pushes every image before the deploy; nothing deployed`;
      record(io, tag, `deploy of ${tag} failed at ${at()}: ${m}`);
      return fail(m);
    }
  } else {
    let buildArgs;
    try { buildArgs = parseBuildArgs(env.DEPLOY_BUILD_ARGS, images, { tag, sha: tagSha }); } catch (e) { return fail(e.message); }
    try { buildOnce(images, tag, tagSha, io, buildArgs); } catch (e) {
      const what = opts.publishOnly ? 'publish' : 'deploy';
      if (opts.publishOnly) io.summary(`${what} of ${tag} failed at ${at()}: ${e.message}`);
      else record(io, tag, `${what} of ${tag} failed at ${at()}: ${e.message} — nothing deployed`);
      return fail(e.message);
    }
    if (opts.publishOnly) {
      const line = `published ${tag} at ${at()} — ${images.map((i) => `${i.ref}:${tag}`).join(', ')}`;
      io.log(line);
      io.summary(line);
      return 0;
    }
  }
  const tags = io.sh('git', ['tag', '--list', 'v*']).stdout.split('\n').map((t) => t.trim()).filter(Boolean);
  const previous = previousFinalTag(tags, tag);

  // 2. Pre-deploy hook — before anything on the platform changes.
  if (env.PRE_DEPLOY && env.PRE_DEPLOY.trim()) {
    const r = io.sh('sh', ['-c', env.PRE_DEPLOY], { inherit: true, env: { ...env, TAG: tag, PREVIOUS_TAG: previous || '' } });
    if (r.status !== 0) {
      record(io, tag, `deploy of ${tag} stopped at ${at()}: the pre-deploy hook failed (exit ${r.status}) — nothing deployed`);
      return fail(`pre-deploy hook failed (exit ${r.status}) — the platform was not called`);
    }
  }

  // 3. Snapshot, then run exactly this tag.
  const refs = images.map((i) => i.ref);
  let snap;
  try { snap = await adapter.snapshot(cfg, io); } catch (e) {
    record(io, tag, `deploy of ${tag} failed at ${at()}: ${e.message} — nothing deployed`);
    return fail(e.message);
  }
  const fileContent = cfg.kind === 'file' ? io.readFile(cfg.composeFile) : undefined;
  if (cfg.kind === 'file' && fileContent === null) return fail(`compose file ${cfg.composeFile} not found in the checkout`);

  let reason = null;
  try {
    await adapter.deploy(cfg, { tag, tagSha, images: refs, fileContent }, io, snap);
    if (!(await waitForVersion(healthUrl, version, io, io.timing.verifyTimeoutS, auth))) {
      throw Object.assign(new Error(`${healthUrl} did not report ${version} within ${io.timing.verifyTimeoutS}s`), { changed: true });
    }
  } catch (e) {
    reason = e;
  }
  if (!reason) {
    const line = `running ${tag} at ${at()} — ${healthUrl} reports ${version}`;
    io.log(line);
    record(io, tag, line);
    return 0;
  }
  if (!reason.changed) {
    record(io, tag, `deploy of ${tag} failed at ${at()}: ${reason.message}`);
    return fail(reason.message);
  }

  // 4. Roll back: what ran before, when it was a final; else the previous final tag.
  const snapTag = snap.ref && /^refs\/tags\//.test(snap.ref) ? snap.ref.slice('refs/tags/'.length) : null;
  const envTag = ((snap.env || []).find((e) => e.name === 'IMAGE_TAG') || {}).value || null;
  const backTag = [snapTag, envTag].find((t) => t && FINAL_TAG.test(t)) || null;
  let back = null; let verified = false;
  try {
    if (backTag) {
      back = backTag;
      await adapter.restore(cfg, snap, io, { tag: backTag, images: refs });
    } else if (previous) {
      back = previous;
      const prevSha = io.sh('git', ['rev-parse', `${previous}^{commit}`]).stdout.trim();
      await adapter.deploy(cfg, { tag: previous, tagSha: prevSha, images: refs, fileContent: snap.fileContent }, io, snap);
    }
    if (back) verified = await waitForVersion(healthUrl, back.slice(1), io, io.timing.verifyTimeoutS, auth);
  } catch (e) {
    io.log(`rollback to ${back} failed: ${e.message}`);
  }
  const line = back
    ? `deploy of ${tag} failed at ${at()}: ${reason.message}; rolled back to ${back} (${verified ? 'verified' : 'NOT verified'})`
    : `deploy of ${tag} failed at ${at()}: ${reason.message}; no rollback target (no previous final tag) — the stack is left as the failed deploy left it`;
  record(io, tag, line);
  return fail(line);
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--publish-only') { o.publishOnly = true; continue; }
    if (a === '--deploy-only') { o.deployOnly = true; continue; }
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (m[1] === 'tag') o.tag = v;
    else if (m[1] === 'health-url') o.healthUrl = v;
    else if (m[1] === 'tag-sha') o.tagSha = v;
  }
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const env = process.env;
  const io = defaultIo(env);
  const num = (k, d) => (Number(env[k]) > 0 ? Number(env[k]) : d);
  io.timing = {
    pollMs: num('POLL_INTERVAL_MS', 5000),
    deployTimeoutS: num('DEPLOY_TIMEOUT_SECONDS', 600),
    busyTimeoutS: num('BUSY_TIMEOUT_SECONDS', 600),
    verifyTimeoutS: num('VERIFY_TIMEOUT_SECONDS', 600),
  };
  run(parseArgs(process.argv.slice(2)), io).then((code) => process.exit(code), (e) => {
    console.log(`::error::${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
}
