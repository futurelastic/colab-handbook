'use strict';
/**
 * `.github/factories.yml` (#739, epic #738): the trust file that lets several independent teams
 * ("factories") work on one repository with nothing shared but its forge.
 *
 * WHAT IT HOLDS. Who the teams are and what each may prove:
 *
 *   version: 1
 *   steward: core                 # the factory that owns intake, trunk health and release
 *   forge: github.com             # the repository's one home forge (a host name)
 *   factories:
 *     core:                       # a MAP keyed by factory id — never a list of factory objects
 *       tier: steward             # steward · partner · outside
 *       machines: [box-a, box-b]  # machine ids, unique across the whole file
 *       key: ssh-ed25519 AAAA…    # ONE SSH public key: signs claim commits and verdict markers
 *       humans: [operator-a]      # logins that count as a human for grants
 *       slices: [slice:core]      # labels; each owned by exactly one factory
 *   steward-areas: [CONVENTIONS.md, .github/**]   # paths whose change needs one steward verdict
 *
 * WHERE IT IS READ FROM is the caller's job, and the rule is the one `trust-humans:` follows: the
 * TRUNK's committed copy, never the branch being judged — a branch that could edit this file could
 * grant itself a factory, a machine or a key. Nothing here reads git.
 *
 * FAIL CLOSED. A malformed file is `valid: false` and every lookup answers "nobody": a reader that
 * fell back to "no factories file" would silently drop every cross-factory rule the adopter
 * declared the file to turn on.
 *
 * THE SIGNATURE FORMATS (mechanics: tools/docs/factories.md; why: docs/adr/739-*.md).
 *   claim commit   an SSH-signed git commit, checked with `git verify-commit` against
 *                  allowedSigners(doc, 'git') — the principal is the factory id.
 *   verdict marker `<!-- colab:verdict phase=<p> v=<v> head=<sha40> factory=<id> sig=<b64> -->`;
 *                  `sig` is an SSH signature (namespace `colab-verdict`) over verdictPayload(),
 *                  never over the comment body. `forge`, `repo` and `issue` in the payload come
 *                  from the VERIFIER's own context, so a marker copied elsewhere fails.
 *
 * PURE: text or a parsed doc in, a verdict out. No git, no network, no ssh-keygen.
 */

const yaml = require('./yaml.js');
const { LOGIN_RE } = require('./trust-humans.js');

/** Where the file lives, relative to the repository root. */
const PATH = '.github/factories.yml';
const VERSION = 1;
const TIERS = ['steward', 'partner', 'outside'];
const TOP_KEYS = ['version', 'steward', 'forge', 'factories', 'steward-areas'];
const FACTORY_KEYS = ['tier', 'machines', 'key', 'humans', 'slices'];

const FACTORY_ID_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const MACHINE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const FORGE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;
const SLICE_RE = /^slice:[a-z0-9][a-z0-9._-]*$/;
/** One OpenSSH public key line: type, base64 blob, optional comment. */
const SSH_KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,2}( [^\s]+)?$/;

// ── the shared vocabulary (CONVENTIONS.md §5, *Factories*) ──────────────────────────────────
// Prose is the source; these are the machine copy. Not in tools/lib/codec yet — that is a closed
// public surface, and nothing writes these strings yet. #743 writes a factory FIELD on claim comments
// (codec/claim.js FACTORY_RE), not the `factory:<id>` label, so none of these moved; the first command
// that writes one of them moves it.
const FACTORY_LABEL_PREFIX = 'factory:';
const SLICE_LABEL_PREFIX = 'slice:';
const QUEUE_READY_LABEL = 'queue:ready';
const REVIEW_LABEL_PREFIX = 'review:';
const AUDIT_STATUS_CONTEXT = 'audit';
/** `review/<check>@<factory>` — the commit-status context one factory's reviewer posts. */
function reviewStatusContext(check, factory) { return `review/${check}@${factory}`; }

// ── signatures ──────────────────────────────────────────────────────────────────────────────
const VERDICT_NAMESPACE = 'colab-verdict';
const CLAIM_NAMESPACE = 'git';
const PAYLOAD_HEADER = 'colab-verdict/1';
/** The signed fields, in signing order. `forge`/`repo` come from the verifier, the rest from the marker. */
const PAYLOAD_FIELDS = ['forge', 'repo', 'issue', 'phase', 'verdict', 'head', 'factory'];
const VERDICTS = ['pass', 'rework', 'blocked', 'escalate'];

function isList(v) { return Array.isArray(v); }
function str(v) { return typeof v === 'string' ? v.trim() : v; }

/**
 * Two factories under one id are merged silently by the YAML subset parser (last one wins), which
 * would hide exactly the clash the validator exists to report. So the raw text is read once more:
 * the direct children of `factories:` and the top-level keys, each seen at most once.
 */
function duplicateKeys(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/(^|\s)#.*$/, '').replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  const top = new Map();
  let inFactories = false;
  let childIndent = null;
  const children = new Map();
  for (const l of lines) {
    const indent = l.match(/^ */)[0].length;
    const m = l.trim().match(/^([^:\s][^:]*):/);
    if (indent === 0) {
      inFactories = false;
      if (m) {
        top.set(m[1], (top.get(m[1]) || 0) + 1);
        if (m[1] === 'factories') { inFactories = true; childIndent = null; }
      }
      continue;
    }
    if (!inFactories || !m) continue;
    if (childIndent === null) childIndent = indent;
    if (indent === childIndent) children.set(m[1], (children.get(m[1]) || 0) + 1);
  }
  for (const [k, n] of top) if (n > 1) out.push(`top-level key \`${k}\` appears ${n} times`);
  for (const [k, n] of children) if (n > 1) out.push(`factory \`${k}\` is declared ${n} times — one id, one factory`);
  return out;
}

/** A list field → its trimmed strings, or a finding. `allowEmpty` for `humans`. */
function listOf(v, what, re, allowEmpty, findings) {
  if (v === null || v === undefined) {
    if (allowEmpty) return [];
    findings.push(`${what} is missing`);
    return [];
  }
  if (!isList(v)) { findings.push(`${what} must be a list, got ${JSON.stringify(v)}`); return []; }
  if (!allowEmpty && v.length === 0) { findings.push(`${what} is an empty list`); return []; }
  const out = [];
  for (const raw of v) {
    const s = str(raw);
    if (typeof s !== 'string' || !re.test(s)) findings.push(`${what} has an invalid entry ${JSON.stringify(raw)}`);
    else out.push(s);
  }
  return out;
}

/**
 * The file's text → `{ valid, findings, doc }`.
 *   doc — `{ version, steward, forge, factories: { <id>: { tier, machines, key, humans, slices } },
 *          stewardAreas }`, normalised; present even when invalid, for a reader that wants to
 *          print what it saw. Never act on it when `valid` is false.
 * Every finding names the field and, for a clash, both factories.
 */
function parseFactories(text) {
  const findings = [];
  let raw;
  try { raw = yaml.parse(String(text == null ? '' : text)); } catch (e) {
    return { valid: false, findings: [`${PATH} could not be parsed: ${e.message}`], doc: null };
  }
  findings.push(...duplicateKeys(text));
  if (!raw || typeof raw !== 'object' || isList(raw)) {
    return { valid: false, findings: [`${PATH} must be a map of keys`], doc: null };
  }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) findings.push(`unknown key \`${k}\``);

  if (raw.version !== VERSION) findings.push(`version must be ${VERSION}, got ${JSON.stringify(raw.version ?? null)}`);
  const forge = str(raw.forge);
  if (typeof forge !== 'string' || !FORGE_RE.test(forge)) findings.push(`forge must be a host name (e.g. github.com), got ${JSON.stringify(raw.forge ?? null)}`);

  const factories = {};
  const fs = raw.factories;
  if (!fs || typeof fs !== 'object' || isList(fs)) {
    findings.push('factories must be a map keyed by factory id (not a list of factory objects)');
  } else {
    for (const [id, f] of Object.entries(fs)) {
      const where = `factories.${id}`;
      if (!FACTORY_ID_RE.test(id)) findings.push(`${where}: a factory id is lowercase letters, digits and hyphens`);
      if (!f || typeof f !== 'object' || isList(f)) { findings.push(`${where} must be a map`); continue; }
      for (const k of Object.keys(f)) if (!FACTORY_KEYS.includes(k)) findings.push(`${where}: unknown key \`${k}\``);
      const tier = str(f.tier);
      if (!TIERS.includes(tier)) findings.push(`${where}.tier must be one of ${TIERS.join(' · ')}, got ${JSON.stringify(f.tier ?? null)}`);
      const key = str(f.key);
      if (typeof key !== 'string' || !SSH_KEY_RE.test(key)) findings.push(`${where}.key must be one SSH public key line (type, base64, optional comment)`);
      factories[id] = {
        tier: TIERS.includes(tier) ? tier : null,
        machines: listOf(f.machines, `${where}.machines`, MACHINE_ID_RE, false, findings),
        key: typeof key === 'string' && SSH_KEY_RE.test(key) ? key : null,
        humans: listOf(f.humans, `${where}.humans`, LOGIN_RE, true, findings).map((h) => h.toLowerCase()),
        slices: listOf(f.slices, `${where}.slices`, SLICE_RE, true, findings),
      };
    }
    if (Object.keys(factories).length === 0) findings.push('factories declares no factory');
  }

  // Across the file: a machine and a slice each belong to exactly one factory.
  for (const [field, noun] of [['machines', 'machine'], ['slices', 'slice']]) {
    const owner = new Map();
    for (const [id, f] of Object.entries(factories)) {
      for (const v of f[field]) {
        const prev = owner.get(v);
        if (prev && prev !== id) findings.push(`${noun} \`${v}\` is claimed by both \`${prev}\` and \`${id}\` — each ${noun} belongs to one factory`);
        else if (prev === id) findings.push(`${noun} \`${v}\` is listed twice in \`${id}\``);
        else owner.set(v, id);
      }
    }
  }
  const keyOwner = new Map();
  for (const [id, f] of Object.entries(factories)) {
    if (!f.key) continue;
    const blob = f.key.split(' ')[1];
    if (keyOwner.has(blob)) findings.push(`factories \`${keyOwner.get(blob)}\` and \`${id}\` share one key — a key identifies one factory`);
    else keyOwner.set(blob, id);
  }

  const steward = str(raw.steward);
  const stewards = Object.entries(factories).filter(([, f]) => f.tier === 'steward').map(([id]) => id);
  if (typeof steward !== 'string' || !factories[steward]) findings.push(`steward must name a declared factory, got ${JSON.stringify(raw.steward ?? null)}`);
  else if (factories[steward].tier !== 'steward') findings.push(`steward \`${steward}\` must have tier steward`);
  if (stewards.length > 1) findings.push(`exactly one factory has tier steward, found ${stewards.map((s) => `\`${s}\``).join(', ')}`);

  const stewardAreas = listOf(raw['steward-areas'], 'steward-areas', /^\S+$/, true, findings);

  const doc = { version: raw.version, steward: steward || null, forge: forge || null, factories, stewardAreas };
  return { valid: findings.length === 0, findings, doc };
}

/** A parsed result, or null — the guard every lookup shares: invalid answers nobody. */
function usable(parsed) { return parsed && parsed.valid && parsed.doc ? parsed.doc : null; }

/** The factory a machine id belongs to, or null (unknown machine, or an invalid file). */
function factoryOfMachine(parsed, machine) {
  const doc = usable(parsed);
  if (!doc) return null;
  for (const [id, f] of Object.entries(doc.factories)) if (f.machines.includes(machine)) return id;
  return null;
}

/** The factory owning a slice label (`slice:<name>`), or null. */
function factoryOfSlice(parsed, label) {
  const doc = usable(parsed);
  if (!doc) return null;
  for (const [id, f] of Object.entries(doc.factories)) if (f.slices.includes(label)) return id;
  return null;
}

/** Whether `login` counts as a human of `factory` (case-insensitive, as logins are). */
function isHumanOf(parsed, factory, login) {
  const doc = usable(parsed);
  const f = doc && doc.factories[factory];
  return !!(f && login && f.humans.includes(String(login).toLowerCase()));
}

/**
 * An OpenSSH allowed_signers file for one namespace: one line per factory, principal = factory id.
 * Feed it to `ssh-keygen -Y verify -f` (verdicts, namespace `colab-verdict`) or set it as
 * `gpg.ssh.allowedSignersFile` for `git verify-commit` (claim commits, namespace `git`).
 * An invalid file yields an EMPTY list — nothing verifies, which is the fail-closed answer.
 */
function allowedSigners(parsed, namespace) {
  const doc = usable(parsed);
  if (!doc) return '';
  return Object.entries(doc.factories)
    .map(([id, f]) => `${id} namespaces="${namespace}" ${f.key.split(' ').slice(0, 2).join(' ')}\n`)
    .join('');
}

const FIELD_VALUE_RE = /^[^\s=]+$/;

/**
 * The canonical payload a verdict signature covers — the exact bytes, as a string:
 *
 *   colab-verdict/1\n
 *   forge=<forge>\n repo=<owner/name>\n issue=<N>\n phase=<phase>\n verdict=<v>\n head=<sha40>\n factory=<id>\n
 *
 * (one field per line, no spaces, LF endings, a trailing LF). `ctx` = `{ forge, repo }` from the
 * verifier's own context — the factories file's `forge` and the repository it is reading — never
 * from the comment. `fields` = `{ issue, phase, verdict, head, factory }`: `issue` is the issue the
 * comment sits on (the verifier's context again — the marker does not carry it), the rest from the
 * marker.
 * Throws on a field that cannot be encoded unambiguously; a signer and a verifier that disagree
 * about bytes would make every signature fail, so there is no lenient mode.
 */
function verdictPayload(fields, ctx) {
  const all = { forge: ctx && ctx.forge, repo: ctx && ctx.repo, ...(fields || {}) };
  all.issue = all.issue == null ? all.issue : String(all.issue);
  if (!/^[1-9][0-9]*$/.test(all.issue || '')) throw new TypeError(`verdictPayload: issue must be a positive integer, got ${JSON.stringify(all.issue)}`);
  if (!/^[0-9a-f]{40}$/.test(all.head || '')) throw new TypeError(`verdictPayload: head must be a full 40-hex commit sha, got ${JSON.stringify(all.head)}`);
  if (!VERDICTS.includes(all.verdict)) throw new TypeError(`verdictPayload: verdict must be one of ${VERDICTS.join(', ')}, got ${JSON.stringify(all.verdict)}`);
  if (!FACTORY_ID_RE.test(all.factory || '')) throw new TypeError(`verdictPayload: factory ${JSON.stringify(all.factory)} is not a factory id`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(all.repo || '')) throw new TypeError(`verdictPayload: repo must be owner/name, got ${JSON.stringify(all.repo)}`);
  for (const k of PAYLOAD_FIELDS) {
    if (typeof all[k] !== 'string' || !FIELD_VALUE_RE.test(all[k])) throw new TypeError(`verdictPayload: ${k} must be a non-empty value with no space or "=", got ${JSON.stringify(all[k])}`);
  }
  return `${PAYLOAD_HEADER}\n${PAYLOAD_FIELDS.map((k) => `${k}=${all[k]}`).join('\n')}\n`;
}

/** An armored SSH signature (`-----BEGIN SSH SIGNATURE-----` …) → the one-line `sig=` value. */
function sigFromArmor(armored) {
  const body = String(armored || '').split(/\r?\n/).filter((l) => l && !/^-----(BEGIN|END) SSH SIGNATURE-----$/.test(l)).join('');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new TypeError('sigFromArmor: not an armored SSH signature');
  return body;
}

/** The one-line `sig=` value → the armored form `ssh-keygen -Y verify -s` reads (70-column lines). */
function armorFromSig(sig) {
  const s = String(sig || '');
  const lines = s.match(/.{1,70}/g) || [];
  return `-----BEGIN SSH SIGNATURE-----\n${lines.join('\n')}\n-----END SSH SIGNATURE-----\n`;
}

const MARKER_RE = /^<!-- colab:verdict ((?:[a-z][a-z0-9_-]*=[^\s=]+=* ?)+)-->$/;

/** `{ phase, verdict, head, factory, sig, extra? }` → the marker. `extra` fields ride UNSIGNED. */
function encodeVerdictMarker({ phase, verdict, head, factory, sig, extra = {} }) {
  const parts = [`phase=${phase}`, `v=${verdict}`, `head=${head}`, `factory=${factory}`];
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  parts.push(`sig=${sig}`);
  for (const p of parts) if (!/^[a-z][a-z0-9_-]*=[^\s=]+=*$/.test(p)) throw new TypeError(`encodeVerdictMarker: field ${JSON.stringify(p)} cannot be encoded`);
  return `<!-- colab:verdict ${parts.join(' ')} -->`;
}

/**
 * One marker line → `{ phase, verdict, head, factory, sig, signed, extra }`, or null.
 * `signed` is true only when it carries both `factory` and `sig` — an unsigned marker (the form
 * written before #739) still decodes, and must never be read as any factory's word.
 */
function decodeVerdictMarker(line) {
  const m = MARKER_RE.exec(String(line || '').trim());
  if (!m) return null;
  const f = {};
  for (const tok of m[1].trim().split(' ')) {
    const i = tok.indexOf('=');
    f[tok.slice(0, i)] = tok.slice(i + 1);
  }
  const known = new Set(['phase', 'v', 'head', 'factory', 'sig']);
  const extra = Object.fromEntries(Object.entries(f).filter(([k]) => !known.has(k)));
  return { phase: f.phase || null, verdict: f.v || null, head: f.head || null, factory: f.factory || null,
    sig: f.sig || null, signed: !!(f.factory && f.sig), extra };
}

module.exports = {
  PATH, VERSION, TIERS, VERDICTS,
  FACTORY_LABEL_PREFIX, SLICE_LABEL_PREFIX, QUEUE_READY_LABEL, REVIEW_LABEL_PREFIX, AUDIT_STATUS_CONTEXT,
  VERDICT_NAMESPACE, CLAIM_NAMESPACE, PAYLOAD_HEADER, PAYLOAD_FIELDS,
  reviewStatusContext, parseFactories, factoryOfMachine, factoryOfSlice, isHumanOf, allowedSigners,
  verdictPayload, sigFromArmor, armorFromSig, encodeVerdictMarker, decodeVerdictMarker,
};
