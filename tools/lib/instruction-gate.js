'use strict';
/**
 * The instruction-file gate (#588) — the ONE git-aware entry point the three enforcement points
 * share: the audit (`checkInstructionFileShape`, warn → fail), the pre-commit hook
 * (`colab instruction-files --staged`) and the reusable CI workflow
 * (`colab instruction-files --base <ref>`). The shape judgement itself is
 * `instruction-file.js` `judgeClaudeMd`, and the ratchet is its `ratchetVerdict`; this module only
 * reads trees out of git and feeds them in. Nothing else re-implements either.
 *
 * Sides a tree can be read from:
 *   { ref: '<rev>' }   a commit (CI's head, the merge base)
 *   'index'            the staged content (the pre-commit hook)
 *   'worktree'         the files on disk, tracked paths only (the audit, which reads the working tree)
 *
 * "Every tracked CLAUDE.md" means every path whose basename is `CLAUDE.md`, at any depth, judged
 * against the `AGENTS.md` beside it. A symlinked CLAUDE.md is read through its link target, so the
 * common `CLAUDE.md -> AGENTS.md` pair reads as one file (conforming), as the audit already treats
 * a byte-identical pair.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const inst = require('./instruction-file.js');

const CLAUDE_RE = /(^|\/)CLAUDE\.md$/;

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (_) {
    return null;
  }
}

/** `[{ path, mode }]` for every CLAUDE.md on `side`; null when the side cannot be read. */
function listClaude(cwd, side) {
  let out;
  if (side === 'index' || side === 'worktree') out = git(cwd, ['ls-files', '-s', '-z']);
  else out = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', side.ref]);
  if (out === null) return null;
  const found = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const p = rec.slice(tab + 1);
    if (!CLAUDE_RE.test(p)) continue;
    found.push({ path: p, mode: rec.split(' ')[0] });
  }
  return found;
}

/** `readFile(rel) -> string|null` on `side`. */
function reader(cwd, side) {
  if (side === 'worktree') {
    return (rel) => {
      try { return fs.readFileSync(path.join(cwd, rel), 'utf8'); } catch (_) { return null; }
    };
  }
  const prefix = side === 'index' ? ':' : `${side.ref}:`;
  return (rel) => git(cwd, ['show', `${prefix}${rel}`]);
}

/**
 * `[{ path, conforming, message }]` — every CLAUDE.md on `side`, judged. null when the side
 * cannot be read (an unknown ref). Symlinks (mode 120000) are followed one hop, in-repo only.
 */
function judgeSide(cwd, side) {
  const list = listClaude(cwd, side);
  if (list === null) return null;
  const read = reader(cwd, side);
  return list.map(({ path: rel, mode }) => {
    let text;
    if (mode === '120000' && side !== 'worktree') {
      const target = (read(rel) || '').trim();
      const r = inst.resolveImport(rel, target);
      text = r.path ? read(r.path) : null;
    } else {
      text = read(rel);
    }
    const agentsRel = path.posix.join(path.posix.dirname(rel), inst.AUTHORED).replace(/^\.\//, '');
    const j = inst.judgeClaudeMd(text, read(agentsRel), rel);
    return { path: rel, conforming: j.conforming, message: j.message };
  });
}

/**
 * Run the gate. Options:
 *   cwd       repo (default process.cwd())
 *   staged    true → judge the index against HEAD (the pre-commit hook)
 *   base      a rev → judge `head` against merge-base(base, HEAD) (CI, the audit)
 *   head      'worktree' to judge the working tree instead of HEAD (the audit); default HEAD
 * With neither `staged` nor `base`, every CLAUDE.md at the head is judged with no ratchet:
 * any non-conforming file fails (`reason: 'strict'`).
 *
 * Returns `{ ok, error?, fail, reason, mode, base, files, bad, changed }`. `ok: false` means the
 * gate could not answer (not a repo, base unknown, merge base not reachable in a shallow clone)
 * — callers must refuse rather than read that as a pass.
 */
function gate({ cwd = process.cwd(), staged = false, base = null, head = null } = {}) {
  if (git(cwd, ['rev-parse', '--git-dir']) === null) return { ok: false, error: `${cwd} is not a git repo` };
  const hasHead = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']) !== null;

  if (staged) {
    const files = judgeSide(cwd, 'index');
    const changed = (git(cwd, ['diff', '--cached', '--name-only', '-z']) || '').split('\0').filter(Boolean);
    const baseFiles = hasHead ? judgeSide(cwd, { ref: 'HEAD' }) : [];
    const v = inst.ratchetVerdict({ changed, head: files, base: baseFiles });
    return { ok: true, mode: 'staged', base: hasHead ? 'HEAD' : null, files, changed, ...v };
  }

  const headSide = head === 'worktree' ? 'worktree' : { ref: head || 'HEAD' };
  if (headSide !== 'worktree' && !hasHead && !head) return { ok: false, error: 'HEAD has no commit yet' };
  const files = judgeSide(cwd, headSide);
  if (files === null) return { ok: false, error: `cannot read ${head || 'HEAD'}` };

  if (!base) {
    const bad = files.filter((f) => !f.conforming);
    return { ok: true, mode: 'strict', base: null, files, changed: [], fail: bad.length > 0, reason: bad.length ? 'strict' : null, bad };
  }

  if (git(cwd, ['rev-parse', '--verify', '-q', `${base}^{commit}`]) === null) {
    return { ok: false, error: `base ${base} is not a commit here — fetch it (a CI checkout needs fetch-depth: 0)` };
  }
  const headRev = headSide === 'worktree' ? 'HEAD' : headSide.ref;
  const mb = (git(cwd, ['merge-base', base, headRev]) || '').trim();
  if (!mb) return { ok: false, error: `no merge base between ${base} and ${headRev} — a shallow clone? (fetch-depth: 0)` };
  const diffArgs = headSide === 'worktree' ? ['diff', '--name-only', '-z', mb] : ['diff', '--name-only', '-z', mb, headRev];
  const changed = (git(cwd, diffArgs) || '').split('\0').filter(Boolean);
  const baseFiles = judgeSide(cwd, { ref: mb });
  const v = inst.ratchetVerdict({ changed, head: files, base: baseFiles });
  return { ok: true, mode: 'ratchet', base: mb, files, changed, ...v };
}

/** One human line per verdict, naming the fix. */
function describe(r) {
  if (!r.ok) return [`cannot judge: ${r.error}`];
  if (!r.bad.length) return [`instruction files conform (${r.files.length} CLAUDE.md judged)`];
  const why = {
    touched: 'this change touches CLAUDE.md/AGENTS.md, so every CLAUDE.md must conform',
    regressed: 'every CLAUDE.md conformed at the merge base, so this would regress the repo',
    strict: 'judged with no base (no ratchet)',
  }[r.reason];
  const lines = r.bad.map((f) => f.message);
  if (r.fail) lines.push(`(${why} — CONVENTIONS.md §9 step 5, #588)`);
  else lines.push('(not failing: unmigrated repo and this change leaves CLAUDE.md/AGENTS.md alone — the ratchet, #588)');
  return lines;
}

module.exports = { CLAUDE_RE, listClaude, reader, judgeSide, gate, describe };
