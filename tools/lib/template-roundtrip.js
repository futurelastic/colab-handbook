'use strict';
/**
 * The Migration round-trip, written live at copy (#625). Pure: text in, text out, no I/O.
 *
 * `migration-grant: reviewer` grants only where a job named "Migration round-trip…" passed at the
 * shipped head (condition R, CONVENTIONS.md §5). ci-node and ci-python carry that job as an opt-in
 * block between `##>>> migration round-trip` / `##<<< migration round-trip` fences — several pairs
 * per file, since the job also needs a workflow env value and a build-job output. Adopting it on a
 * LATER branch edits .github/workflows/, and such a branch fails R by construction, so the one
 * branch that adopts the job ships on a human grant. Writing it at copy — the commit that creates
 * the workflows — removes that branch.
 *
 * Fail closed: with ROUNDTRIP_APPLY empty, the build job's `roundtrip` output is `off` and the job
 * is skipped. A skipped leg never passes R, and CI stays green — a repo with no migrations yet is
 * not held red. A no-op job that ended green would pass R; this module never produces one.
 *
 * Uncommenting is the template's own recipe, `sed '/^  ##>>>/,/^  ##<<</ s/^  # \{0,1\}/  /'`,
 * applied to the round-trip fences only.
 */

const FENCE_OPEN = /^  ##>>> migration round-trip/;
const FENCE_CLOSE = /^  ##<<< migration round-trip/;

/** Templates whose job is always on (nothing to enable). */
const ALWAYS_ON = new Set(['ci-laravel']);

/** Is there an opt-in round-trip block in this template text? */
function hasRoundtripFence(text) {
  return String(text).split('\n').some((l) => FENCE_OPEN.test(l));
}

/** A YAML single-quoted scalar: `'` doubles, nothing else escapes. */
function yamlSingleQuoted(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Why `--roundtrip` cannot apply to template `stem`, or null when it can. `text` is the template.
 * A heavy lane runs nightly and on release candidates, never on a branch head — R reads the
 * shipped head, so a round-trip there could never pass it.
 */
function refusal(stem, text) {
  if (/-heavy$/.test(stem)) {
    return `${stem} is the heavy lane: it never runs at a branch's head, and R reads the round-trip at the shipped head — so a round-trip there could never pass R. Put it in the light lane: colab template ${stem.replace(/-heavy$/, '')} --roundtrip`;
  }
  if (ALWAYS_ON.has(stem)) return null;
  if (!hasRoundtripFence(text)) return `${stem} has no Migration round-trip block to enable`;
  return null;
}

/**
 * Uncomment every round-trip fence and fill the values the copy can know.
 * opts: { apply?: string, paths?: string[] }. Returns { text, changes: [what], missed: [what] }.
 * `apply` with a newline is refused (throws): ROUNDTRIP_APPLY is one shell line.
 */
function enableRoundtrip(text, opts) {
  const o = opts || {};
  if (o.apply != null && /[\r\n]/.test(o.apply)) throw new Error('--roundtrip-apply must be one line');
  const changes = [];
  const missed = [];
  let inside = false;
  let fences = 0;
  let out = String(text).split('\n').map((l) => {
    if (FENCE_OPEN.test(l)) { inside = true; fences += 1; return l; }
    if (FENCE_CLOSE.test(l)) { inside = false; return l; }
    return inside ? l.replace(/^  # ?/, '  ') : l;
  }).join('\n');
  if (!fences) return { text: String(text), changes, missed: ['round-trip block'] };
  changes.push(`uncommented ${fences} fenced block${fences === 1 ? '' : 's'}`);

  const apply = o.apply == null ? '' : String(o.apply).trim();
  if (apply) {
    const re = /^  ROUNDTRIP_APPLY: ""$/m;
    if (re.test(out)) {
      out = out.replace(re, `  ROUNDTRIP_APPLY: ${yamlSingleQuoted(apply)}`);
      changes.push('ROUNDTRIP_APPLY');
    } else missed.push('ROUNDTRIP_APPLY');
  }
  const paths = (o.paths || []).filter(Boolean);
  if (paths.length) {
    const re = /^      MIGRATIONS_PATHS: "[^"\n]*"$/m;
    if (re.test(out)) {
      out = out.replace(re, `      MIGRATIONS_PATHS: ${yamlSingleQuoted(paths.join(' '))}`);
      changes.push('MIGRATIONS_PATHS (from .github/project.yml migrations:)');
    } else missed.push('MIGRATIONS_PATHS');
  }
  return { text: out, changes, missed };
}

module.exports = { FENCE_OPEN, FENCE_CLOSE, ALWAYS_ON, hasRoundtripFence, refusal, enableRoundtrip, yamlSingleQuoted };
