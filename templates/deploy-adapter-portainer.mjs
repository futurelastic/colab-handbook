#!/usr/bin/env node
// deploy adapter (Portainer) — TEMPLATE. Copy me into your repo next to deploy-container-run.mjs
// (`colab template deploy-adapter-portainer.mjs --dest .github/deploy/deploy-adapter-portainer.mjs`)
// and OWN the copy, exactly like the workflow templates (templates/README.md). Nothing here calls
// back to the handbook, and nothing here updates itself.
//
// WHAT IT IS. One platform adapter behind templates/deploy-container.yml (colab-handbook #452). The
// driver (deploy-container-run.mjs) builds the images and decides WHAT runs; an adapter only tells
// ONE platform "run exactly this tag" and proves that it did. A second platform is a second file
// exporting the same five names (`name`, `configFromEnv`, `snapshot`, `deploy`, `restore`) — the
// consuming workflow then changes only DEPLOY_ADAPTER, never its steps.
//
// TOPOLOGY. Every server runs its own Portainer: no central panel, no Portainer Agents. So the
// whole per-app configuration is THAT host's Portainer URL + endpointId + stack id + one key:
//
//   PORTAINER_URL           https://portainer.app.example.com — a DNS name, never an address
//   PORTAINER_ENDPOINT_ID   the environment (endpoint) id the stack lives in
//   PORTAINER_STACK_ID      the stack's id
//   PORTAINER_STACK_KIND    git (default) | file
//   PORTAINER_COMPOSE_FILE  file stacks only: the compose file sent as the stack content
//   PORTAINER_API_KEY       the secret — an access token of a NON-ADMIN user that owns only this
//                           app's stack. Never an admin key: a leaked deploy key must reach one app.
//
// MEASURED (Portainer CE 2.45.1, git stacks):
//   - `PUT /api/stacks/{id}/git/redeploy` honours `RepositoryReferenceName: refs/tags/vX.Y.Z`.
//   - 200 only means ACCEPTED: the redeploy is asynchronous. `Status` is 3 while deploying and 1
//     once active; `GitConfig.ConfigHash` then holds the commit actually deployed.
//   - 409 = a deploy is already in progress (busy: wait, retry). 500 = a hard failure, returned
//     synchronously, and nothing changed (e.g. a tag that does not exist).
//   - `Env` sent on redeploy REPLACES the stack's whole list — so this sends the full current list
//     with IMAGE_TAG replaced, never only the changed key.
//   - EVERY REDEPLOY RECREATES THE CONTAINERS, even when the compose file did not change: expect a
//     short restart on every deploy, including a rollback.
//   - A call can return 200 while the environment refused the container (e.g. a bind mount blocked
//     for a non-admin user). So success is read from what RUNS — the running containers' image —
//     never from the HTTP status.
// NOT MEASURED (assumptions, each a place to check first if your deploy misbehaves): file-stack
// `PUT /api/stacks/{id}` being asynchronous too (this polls either way); a non-admin, stack-owning
// key being allowed to list its stack's containers through the Docker proxy; private-repository
// auth on redeploy (this reuses a stored git credential id, and refuses otherwise).

export const name = 'portainer';

export class AdapterError extends Error {
  /** kind: 'hard' (refused synchronously, nothing changed) | 'busy' (a deploy never freed up) |
   *  'refused' (accepted, but what runs is not what was asked) | 'config'. */
  constructor(kind, message, { changed = false } = {}) {
    super(message);
    this.kind = kind;
    this.changed = changed;
  }
}

const STATUS_ACTIVE = 1;
const STATUS_DEPLOYING = 3;

/** The adapter's configuration from env; throws naming every missing key. */
export function configFromEnv(env) {
  const need = ['PORTAINER_URL', 'PORTAINER_ENDPOINT_ID', 'PORTAINER_STACK_ID', 'PORTAINER_API_KEY'];
  const missing = need.filter((k) => !String(env[k] || '').trim());
  if (missing.length) throw new AdapterError('config', `portainer adapter: missing ${missing.join(', ')}`);
  const kind = String(env.PORTAINER_STACK_KIND || 'git').trim();
  if (!['git', 'file'].includes(kind)) throw new AdapterError('config', `PORTAINER_STACK_KIND is "${kind}", expected git or file`);
  return {
    url: String(env.PORTAINER_URL).trim().replace(/\/+$/, ''),
    endpointId: String(env.PORTAINER_ENDPOINT_ID).trim(),
    stackId: String(env.PORTAINER_STACK_ID).trim(),
    kind,
    composeFile: String(env.PORTAINER_COMPOSE_FILE || 'docker-compose.yml').trim(),
    apiKey: String(env.PORTAINER_API_KEY).trim(),
  };
}

/** The full env list with every `kv` key replaced in place or appended — never a partial list. */
export function mergeEnv(list, kv) {
  const out = (list || []).map((e) => ({ name: e.name, value: e.value }));
  for (const [k, v] of Object.entries(kv)) {
    const at = out.findIndex((e) => e.name === k);
    if (at >= 0) out[at] = { name: k, value: v };
    else out.push({ name: k, value: v });
  }
  return out;
}

async function call(cfg, io, method, path, body) {
  const res = await io.fetch(`${cfg.url}${path}`, {
    method,
    headers: { 'X-API-Key': cfg.apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
}

async function getStack(cfg, io) {
  const r = await call(cfg, io, 'GET', `/api/stacks/${cfg.stackId}`);
  if (r.status !== 200 || !r.json) throw new AdapterError('hard', `GET /api/stacks/${cfg.stackId} answered ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}

/** What the stack runs now — the rollback target and the base of every Env sent. */
export async function snapshot(cfg, io) {
  const s = await getStack(cfg, io);
  const snap = {
    kind: cfg.kind,
    name: s.Name,
    ref: (s.GitConfig && s.GitConfig.ReferenceName) || null,
    configHash: (s.GitConfig && s.GitConfig.ConfigHash) || null,
    gitCredentialId: (s.GitConfig && s.GitConfig.Authentication && s.GitConfig.Authentication.GitCredentialID) || 0,
    privateRepo: Boolean(s.GitConfig && s.GitConfig.Authentication),
    env: (s.Env || []).map((e) => ({ name: e.name, value: e.value })),
    fileContent: null,
  };
  if (cfg.kind === 'file') {
    const f = await call(cfg, io, 'GET', `/api/stacks/${cfg.stackId}/file`);
    if (f.status !== 200 || !f.json) throw new AdapterError('hard', `GET /api/stacks/${cfg.stackId}/file answered ${f.status}`);
    snap.fileContent = f.json.StackFileContent;
  }
  return snap;
}

function requestFor(cfg, snap, { ref, env, fileContent }) {
  const q = `?endpointId=${encodeURIComponent(cfg.endpointId)}`;
  if (cfg.kind === 'git') {
    const body = { RepositoryReferenceName: ref, Env: env, PullImage: true, Prune: true, RepositoryAuthentication: false };
    if (snap.privateRepo) {
      if (!snap.gitCredentialId) {
        throw new AdapterError('hard', 'the stack pulls a private repository without a stored git credential — unsupported here (unmeasured); store a git credential in Portainer for the stack');
      }
      body.RepositoryAuthentication = true;
      body.RepositoryGitCredentialID = snap.gitCredentialId;
    }
    return { method: 'PUT', path: `/api/stacks/${cfg.stackId}/git/redeploy${q}`, body };
  }
  return { method: 'PUT', path: `/api/stacks/${cfg.stackId}${q}`, body: { StackFileContent: fileContent, Env: env, PullImage: true, Prune: true } };
}

/** Send one deploy request: 409 waited out and retried, any other non-200 a hard failure. */
async function send(cfg, snap, req, io) {
  const t = io.timing;
  const busyUntil = io.now() + t.busyTimeoutS * 1000;
  for (;;) {
    const r = await call(cfg, io, req.method, req.path, req.body);
    if (r.status === 200) return;
    if (r.status === 409) {
      if (io.now() >= busyUntil) throw new AdapterError('busy', `the stack stayed busy (409) for ${t.busyTimeoutS}s — nothing was changed by this run`);
      io.log(`portainer: a deploy is already in progress (409) — waiting for it, then retrying`);
      await waitWhileDeploying(cfg, io, busyUntil);
      continue;
    }
    throw new AdapterError('hard', `${req.method} ${req.path.split('?')[0]} answered ${r.status}: ${r.text.slice(0, 300)} — nothing changed`);
  }
}

async function waitWhileDeploying(cfg, io, until) {
  for (;;) {
    const s = await getStack(cfg, io);
    if (s.Status !== STATUS_DEPLOYING) return s;
    if (io.now() >= until) return s;
    await io.sleep(io.timing.pollMs);
  }
}

/**
 * Accepted is not deployed: wait for the stack to leave "deploying", require it active, require the
 * git commit asked for, then require every listed image running at `tag`.
 */
async function settle(cfg, { tag, tagSha, images }, io) {
  const until = io.now() + io.timing.deployTimeoutS * 1000;
  const s = await waitWhileDeploying(cfg, io, until);
  if (s.Status === STATUS_DEPLOYING) throw new AdapterError('refused', `the stack was still deploying after ${io.timing.deployTimeoutS}s`, { changed: true });
  if (s.Status !== STATUS_ACTIVE) throw new AdapterError('refused', `the stack settled with Status ${s.Status}, not active (1)`, { changed: true });
  if (cfg.kind === 'git' && tagSha) {
    const got = s.GitConfig && s.GitConfig.ConfigHash;
    if (got !== tagSha) throw new AdapterError('refused', `the stack runs commit ${got || '(none)'}, not ${tag}'s ${tagSha}`, { changed: true });
  }
  if (!images || !images.length) return;
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${s.Name}`] }));
  const r = await call(cfg, io, 'GET', `/api/endpoints/${encodeURIComponent(cfg.endpointId)}/docker/containers/json?all=1&filters=${filters}`);
  if (r.status !== 200 || !Array.isArray(r.json)) {
    throw new AdapterError('refused', `could not list the stack's containers (${r.status}) — success is read from what runs, so this fails`, { changed: true });
  }
  const notRunning = images.filter((ref) => !r.json.some((c) => c.Image === `${ref}:${tag}` && c.State === 'running'));
  if (notRunning.length) {
    const seen = r.json.map((c) => `${c.Image} (${c.State})`).join(', ') || 'no containers';
    throw new AdapterError('refused', `accepted, but not running ${notRunning.map((i) => `${i}:${tag}`).join(', ')} — found ${seen}`, { changed: true });
  }
}

/** Run exactly `target.tag`: every listed image in one call, then prove it runs. */
export async function deploy(cfg, target, io, snap) {
  const base = snap || (await snapshot(cfg, io));
  const env = mergeEnv(base.env, { IMAGE_TAG: target.tag, ...(target.env || {}) });
  const req = requestFor(cfg, base, { ref: `refs/tags/${target.tag}`, env, fileContent: target.fileContent });
  await send(cfg, base, req, io);
  await settle(cfg, target, io);
}

/** Put back exactly what `snap` recorded — its ref, its whole Env, its file content. */
export async function restore(cfg, snap, io, { tag, images } = {}) {
  const req = requestFor(cfg, snap, { ref: snap.ref, env: snap.env, fileContent: snap.fileContent });
  await send(cfg, snap, req, io);
  await settle(cfg, { tag, tagSha: snap.configHash, images: tag ? images : [] }, io);
}
