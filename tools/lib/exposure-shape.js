'use strict';
/**
 * exposure-shape.js — #207: the ONE shared representation of the exposure mechanism contract
 * (CONVENTIONS.md §2, "Exposure"), consumed by both halves that used to hand-encode it
 * separately:
 *
 *   - the VALIDATOR (`audit/audit.mjs`'s exposure-voiced block, #144) — given a descriptor that
 *     already declares an exposure, report EVERY mechanism violation it finds.
 *   - the CONSTRUCTOR (`tools/lib/adopt.js`'s `EXPOSURE_SHAPE`, #199) — given a shape a repo is
 *     actually in, decide whether DECLARING a given exposure is supported at all, stopping at
 *     the first reason it is not.
 *
 * Before this file, those were ~130 lines of fail/warn closures (audit) and a ~100-line table of
 * ok/reason closures (adopt) — the exact duplication this handbook's own anti-pattern list warns
 * about, guarded only by `tools/lib/adopt-audit-agreement.test.js`'s matrix (now folded into this
 * module's own test file, see the note there for why the agreement test was retired rather than
 * kept alongside a single source).
 *
 * `evaluateExposure(exposure, ctx)` returns an ORDERED array of entries — empty means the shape
 * cleanly supports this exposure. Two entry shapes:
 *
 *   { kind: 'fail', message }         a ready-to-report violation; both sides treat it as one.
 *   { kind: 'runbook', why, message } deploy runs outside CI and needs a `runbook:` — `why` is
 *                                     the file-aware checkRunbook() label the VALIDATOR uses
 *                                     (it can read the repo and tell "missing" from "unreadable
 *                                     via the API"); `message` is the generic text the
 *                                     CONSTRUCTOR uses when it only has a boolean
 *                                     (`ctx.hasRunbook`) to go on. Whether this entry actually
 *                                     BLOCKS depends on the caller, which is why it is not
 *                                     folded into `kind: 'fail'`: only the caller knows whether
 *                                     the runbook requirement is currently satisfied.
 *
 * `self` always returns `[]` — CONVENTIONS.md §2: self's consumer set is a subset of the room's,
 * no mechanism rule applies to it at all, not even trunk shape.
 *
 * MULTIPLE entries may fire for one bad shape (e.g. `deploy: push-main` with the wrong trunk is
 * two independent problems) — this mirrors the original, un-refactored audit block exactly,
 * which was a sequence of independent `if`s, never an early return. The VALIDATOR reports every
 * entry; the CONSTRUCTOR reads only the first, which is why entries are pushed in the same order
 * `EXPOSURE_SHAPE`'s old early-return checks ran in (push-main, then none/null, then an
 * off-enum catch-all, then the runbook/workflow branch, then trunk) — order is otherwise
 * unobservable from the validator side, since it reports the whole set regardless of order.
 *
 * The off-enum "catch-all" fail in the `released`-with-production shape is DEAD CODE on the
 * validator side by construction: `deploy` is already validated as one of `tag`/`manual`/
 * `push-main`/`none`/null by an earlier, unconditional check in `audit/audit.mjs` (before the
 * axis dispatch even runs) and, on the constructor side, by `tools/colab`'s own `--deploy`
 * flag validation before `exposureShapeVerdict` is ever called for a NEWLY PROPOSED value. It is
 * kept because `exposureShapeVerdict` can also be asked about an EXISTING, already-committed
 * `deploy:` that was never re-validated (a hand-edited `project.yml`) — removing it would let a
 * hand-typo'd deploy value read as cleanly declarable.
 *
 * Context shape both sides build (identically named, audit.mjs and adopt.js each computing the
 * booleans from their own sources — a real git checkout for one, a `git status`-aware `io` for
 * the other):
 *   { trunk, hasProduction, deploy, hasDeployWorkflow, hasRunbook, deployWorkflowNames? }
 * `deployWorkflowNames` is OPTIONAL and cosmetic only (the `none` violation names which
 * workflow(s) contradict it) — omitting it (as adopt.js's ctx does) only drops the parenthetical
 * from the message, never changes which entries fire.
 */

function evaluateExposure(exposure, ctx) {
  switch (exposure) {
    case 'self':
      return [];
    case 'none':
      return evaluateNone(ctx);
    case 'live':
      return evaluateLive(ctx);
    case 'released':
      return ctx.hasProduction ? evaluateReleasedWithProduction(ctx) : evaluateReleasedNoProduction(ctx);
    default:
      return [];
  }
}

function evaluateNone(ctx) {
  const out = [];
  if (ctx.trunk !== 'main') {
    out.push({
      kind: 'fail',
      message: `exposure: none requires trunk "main", found ${JSON.stringify(ctx.trunk)} — nothing `
        + 'consumes this repo, so there is no release branch to speak of',
    });
  }
  if (ctx.hasDeployWorkflow) {
    const names = Array.isArray(ctx.deployWorkflowNames) && ctx.deployWorkflowNames.length
      ? ` (${ctx.deployWorkflowNames.join(', ')})` : '';
    out.push({
      kind: 'fail',
      message: `exposure: none but a deploy workflow exists${names} — nothing is supposed to `
        + 'consume this repo, yet something is wired to deploy it',
    });
  }
  return out;
}

function evaluateLive(ctx) {
  const out = [];
  // #205: validates the two-branch SPLIT, not the spelling — trunk must be declared and
  // distinct from "main" (the release branch the promotion deploys to), never required to
  // literally be "dev". "dev" is the default project.schema.md's `trunk` section and the
  // templates propose; a repo naming its trunk something else is conforming, not exempted.
  if (!ctx.trunk || ctx.trunk === 'main') {
    out.push({
      kind: 'fail',
      message: `exposure: live requires trunk to be a branch distinct from "main", found ${JSON.stringify(ctx.trunk)} `
        + '— the promotion is the deploy, and trunk (dev by default) is where sessions land before it ships',
    });
  }
  if (!ctx.hasProduction) {
    out.push({ kind: 'fail', message: 'exposure: live but production is null — the promotion ships straight to users, so a live URL must be set' });
  }
  if (ctx.deploy !== 'push-main') {
    out.push({
      kind: 'fail',
      message: `exposure: live requires deploy: push-main, found ${JSON.stringify(ctx.deploy)} `
        + '— the promotion itself IS the deploy',
    });
  }
  if (!ctx.hasDeployWorkflow) {
    out.push({
      kind: 'fail',
      message: 'exposure: live but no .github/workflows/deploy-*.yml — the promotion needs a '
        + 'committed path to production (no runbook: escape hatch here — live means the '
        + 'promotion itself deploys)',
    });
  }
  return out;
}

function evaluateReleasedNoProduction(ctx) {
  const out = [];
  if (ctx.trunk !== 'main') {
    out.push({
      kind: 'fail',
      message: `exposure: released with production: null requires trunk "main", found `
        + `${JSON.stringify(ctx.trunk)} — nothing is live, so there is no release branch to speak of`,
    });
  }
  if (ctx.deploy !== null && ctx.deploy !== undefined && ctx.deploy !== 'none') {
    out.push({
      kind: 'fail',
      message: `exposure: released with production: null and deploy: ${JSON.stringify(ctx.deploy)} `
        + 'is contradictory — nothing is live to deploy to; use deploy: none, or set production if something IS live',
    });
  }
  return out;
}

function evaluateReleasedWithProduction(ctx) {
  const out = [];

  if (ctx.deploy === 'push-main') {
    out.push({
      kind: 'fail',
      message: 'exposure: released with deploy: push-main — released means a deliberate release '
        + 'artifact gates production, and here every push to main reaches users with no such '
        + 'gate. Options include: declare exposure: live instead (that IS this shape), migrate '
        + 'the pipeline to a tag trigger (deploy: tag), or — if shipping really is run by hand '
        + '— deploy: manual plus runbook: naming the committed procedure.',
    });
  }
  if (ctx.deploy === 'none' || ctx.deploy === null || ctx.deploy === undefined) {
    out.push({ kind: 'fail', message: 'exposure: released with a live production URL but deploy: none is contradictory — use "tag" or "manual"' });
  }
  // Dead code on the validator side — see the file banner. Kept for the constructor, asked about
  // an EXISTING, never-re-validated `deploy:` value.
  if (ctx.deploy !== 'tag' && ctx.deploy !== 'manual' && ctx.deploy !== 'push-main'
    && ctx.deploy !== 'none' && ctx.deploy !== null && ctx.deploy !== undefined) {
    out.push({
      kind: 'fail',
      message: `deploy is ${JSON.stringify(ctx.deploy)} — exposure: released with a live production URL needs deploy: tag or deploy: manual`,
    });
  }

  // The runbook/no-workflow branch is MUTUALLY EXCLUSIVE with itself (never both), same as the
  // original audit if/else-if chain, but independent of every other entry above and below it.
  const externalTagDeploy = ctx.deploy === 'tag' && !ctx.hasDeployWorkflow;
  if (ctx.deploy === 'manual' || externalTagDeploy) {
    const why = ctx.deploy === 'manual'
      ? 'exposure: released, deploy: manual'
      : 'exposure: released, deploy: tag deployed outside CI (an external GitOps poller)';
    out.push({ kind: 'runbook', why, message: `${why} requires runbook: — name the committed doc that describes how production is reached` });
  } else if (!ctx.hasDeployWorkflow) {
    out.push({
      kind: 'fail',
      message: 'exposure: released but no .github/workflows/deploy-*.yml — the path to production '
        + 'is not in the repo (use deploy: manual + runbook: if it ships by hand, or deploy: tag '
        + '+ runbook: when a GitOps poller deploys the tag from outside CI)',
    });
  }

  if (ctx.trunk !== 'dev' && !(ctx.deploy === 'tag' && ctx.trunk === 'main')) {
    out.push({
      kind: 'fail',
      message: ctx.deploy === 'tag'
        ? `exposure: released with deploy: tag requires trunk "dev" or "main", found ${JSON.stringify(ctx.trunk)}`
        : `exposure: released requires trunk "dev", found ${JSON.stringify(ctx.trunk)} — only a `
          + 'tag-gated release (deploy: tag) may run a single trunk "main"',
    });
  }

  return out;
}

module.exports = { evaluateExposure };
