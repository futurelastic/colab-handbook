'use strict';
/**
 * #436: a pre-ship hook's exit code is a claim ("ZERO means every conflicted path was resolved"),
 * not proof. A hook that regenerates a path's NEW layout and then `git add`s an OLD path still full
 * of conflict markers exits 0 and stages the markers — git clears the unmerged state on `add`, so
 * `git diff --diff-filter=U` reads clean. This reads what would actually be committed.
 *
 * Detection is deliberately `<<<<<<<` / `>>>>>>>` at column 0 (followed by a space or end of line).
 * A bare `=======` line is NOT a marker on its own: it is also a legitimate Markdown setext-heading
 * underline, and generated docs are exactly the files this check reads. Every real conflict block
 * carries the two outer markers, so nothing is missed by not counting the middle one alone.
 */

const MARKER = /^(<{7}|>{7})(?:[ \t]|$)/;

/** Pure: 1-based line numbers of conflict-marker lines in `text`. */
function markerLines(text) {
  const out = [];
  String(text == null ? '' : text).split('\n').forEach((line, i) => {
    if (MARKER.test(line.replace(/\r$/, ''))) out.push(i + 1);
  });
  return out;
}

/**
 * Which of `paths` still hold conflict markers in the INDEX (stage 0 — what `git commit` takes) at
 * `cwd`. `gitFn(args, cwd)` → `{ ok, stdout }`. A path absent from the index (deleted, or still
 * unmerged at stages 1-3) is skipped here: deletion is a resolution, and an unmerged path is the
 * caller's existing `--diff-filter=U` check. Returns `[{ path, lines }]`.
 */
function stagedMarkerPaths(gitFn, cwd, paths) {
  const hits = [];
  for (const p of [...new Set(paths || [])]) {
    const r = gitFn(['show', `:0:${p}`], cwd);
    if (!r || !r.ok) continue;
    const lines = markerLines(r.stdout);
    if (lines.length) hits.push({ path: p, lines });
  }
  return hits;
}

/** One line naming each path and its first marker lines. */
function describe(hits) {
  return (hits || []).map((h) => `${h.path}:${h.lines.slice(0, 3).join(',')}${h.lines.length > 3 ? ',…' : ''}`).join(', ');
}

module.exports = { markerLines, stagedMarkerPaths, describe };
