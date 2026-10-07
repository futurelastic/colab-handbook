#!/usr/bin/env bash
# install.sh — set up this machine to use the colab-handbook: skills, the colab
# CLI, the pre-commit hook, and the fleet list. All by symlink or copy.
# Idempotent and safe to re-run.
#
#   ./install.sh          install the skills for your coding agent(s), user level — available
#                         in every repo you open. At a terminal it ASKS which engine(s): one
#                         data file per engine in engines/ (Claude Code, Codex, …) plus
#                         "other: give a path". Not at a terminal, with no flag below, it keeps
#                         every engine it finds already linked — and, finding none, defaults to
#                         Claude Code and says so (#530).
#   ./install.sh --engine claude,codex
#                         install for these engines, no question asked (ids: engines/*.conf).
#   ./install.sh --skills-dir <path>
#                         install into this folder too — any engine engines/ does not know.
#                         Remembered in <COLAB_HOME>/skills-dirs so re-runs and --check find it.
#   ./install.sh --tools  ALSO symlink tools/colab onto your PATH (~/.local/bin/colab)
#                         AND freeze a stamped copy of the CLI at ~/.colab/bin/colab.
#   ./install.sh --hooks  ALSO enable this clone's gitleaks pre-commit hook
#                         (runs .githooks/install.sh; per-machine, not synced).
#   ./install.sh --fleet  ALSO seed ~/.colab/repos.txt from audit/repos.txt —
#                         only when absent; an existing fleet list is never touched.
#   ./install.sh --all    = --tools --hooks --fleet (the recommended first run).
#   ./install.sh --notify-url <url>
#                         add a local observer's events URL to notifyUrl in
#                         ~/.colab/config.json when the key lacks it; never removes or
#                         rewrites an existing entry. --tools also adds every URL declared in
#                         <COLAB_HOME>/notify-endpoint (one per line, one per observer) that
#                         the key lacks, and otherwise says plainly that notifyUrl is unset
#                         and which events that drops.
#   ./install.sh --release
#                         check this clone out at the newest FINAL release tag (vX.Y.Z, no -rc),
#                         then install from it. Re-run it to move to a newer release.
#   ./install.sh --trunk  follow trunk instead: check out the trunk branch (project.yml `trunk:`)
#                         and install unreleased work — the clone's equivalent of npm's @next.
#                         With neither flag, a FIRST install from a fresh clone of trunk pins
#                         itself to the newest final release (#521); any other run keeps whatever
#                         the clone has checked out and says which one that is.
#                         COLAB_INSTALL_REF=release|trunk is the same choice as an env var;
#                         COLAB_INSTALL_REF=keep never moves the checkout (tests, automation).
#   ./install.sh --dry    print what would happen; change nothing. Combines with
#                         any of the above.
#   ./install.sh --check  READ-ONLY health report of what an earlier install left
#                         behind: is the frozen copy behind the handbook, and which
#                         commands does it not dispatch; is the state file there;
#                         is anything registered in the fleet; can the hooklets run.
#                         Exit 1 on any ✗ row. ✗ means installed-but-stale-or-broken; something
#                         merely never set up (no repo registered yet, no identity vocabulary)
#                         is ⚠ and exits 0. Takes no other flag.
#
# A preflight runs on every invocation. It only reports (✓ / ⚠) and never aborts:
# a tool you have not installed must not block the parts that do not need it.
#
# Safety: a destination that already exists and is NOT a symlink back to us is
# left untouched (skipped with a warning) — so a repo's own richer skill, or a
# hand-made file, is never clobbered.
#
# KNOW WHAT A SYMLINK INSTALL MEANS: every link points into THIS WORKING TREE, not
# at a copied snapshot. Checking this repo out onto a branch therefore changes the
# skills — and, with --tools, the CLI on your PATH — for every session on the machine,
# instantly and invisibly. That is the point (edit and it is live) and the hazard (a
# half-finished branch left checked out is a half-finished toolchain for everyone).
# Work on this repo in a WORKTREE and leave the main checkout on trunk, which is what
# the handbook asks of every other repo for the same reason.
#
# THE ONE EXCEPTION IS THE FROZEN COPY. Following the working tree is right for a human
# session and wrong for a process that outlives it: an always-on service started months
# ago must not change behaviour because somebody checked out an unrelated branch. So
# --tools ALSO writes a snapshot COPY to ~/.colab/bin/ (honouring COLAB_HOME), stamped
# with the handbook version it came from. Point every always-on service — launch agents,
# daemons, headless runners — at ~/.colab/bin/colab, never at ~/.local/bin/colab.
# Refreshing it is then a deliberate act: re-run install.sh. `colab update` reports it
# when the CLI has moved on since that stamp.
set -eo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$DIR/skills"
ENGINES_DIR="$DIR/engines"
TOOL_SRC="$DIR/tools/colab"
TOOL_DEST="$HOME/.local/bin/colab"
COLAB_DIR="${COLAB_HOME:-$HOME/.colab}"
FLEET_SRC="$DIR/audit/repos.txt"
FLEET_DEST="$COLAB_DIR/repos.txt"
FROZEN_DIR="$COLAB_DIR/bin"
FROZEN_BIN="$FROZEN_DIR/colab"
FROZEN_STAMP="$FROZEN_DIR/STAMP"
SKILL_DIRS_FILE="$COLAB_DIR/skills-dirs"

WITH_TOOLS=0; WITH_HOOKS=0; WITH_FLEET=0; DRY=0; CHECK=0; NOTIFY_URL=""; NOTIFY_FLAG=0
REF_MODE="${COLAB_INSTALL_REF:-}"; REF_FLAG=0
ENGINE_FLAG=""; SKILLS_DIR_FLAG=""
NARGS=$#
while [ $# -gt 0 ]; do
  a="$1"; shift
  case "$a" in
    --notify-url=*) NOTIFY_URL="${a#--notify-url=}"; NOTIFY_FLAG=1 ;;
    --notify-url)
      [ $# -gt 0 ] || { echo "--notify-url needs a URL" >&2; exit 2; }
      NOTIFY_URL="$1"; NOTIFY_FLAG=1; shift ;;
    --engine=*) ENGINE_FLAG="${ENGINE_FLAG:+$ENGINE_FLAG,}${a#--engine=}" ;;
    --engine)
      [ $# -gt 0 ] || { echo "--engine needs an engine id (see engines/*.conf)" >&2; exit 2; }
      ENGINE_FLAG="${ENGINE_FLAG:+$ENGINE_FLAG,}$1"; shift ;;
    --skills-dir=*) SKILLS_DIR_FLAG="${a#--skills-dir=}" ;;
    --skills-dir)
      [ $# -gt 0 ] || { echo "--skills-dir needs a folder" >&2; exit 2; }
      SKILLS_DIR_FLAG="$1"; shift ;;
    --check) CHECK=1 ;;
    --tools) WITH_TOOLS=1 ;;
    --hooks) WITH_HOOKS=1 ;;
    --fleet) WITH_FLEET=1 ;;
    --all)   WITH_TOOLS=1; WITH_HOOKS=1; WITH_FLEET=1 ;;
    --dry|--dry-run) DRY=1 ;;
    --release|--trunk)
      m="${a#--}"
      if [ "$REF_FLAG" = 1 ] && [ "$REF_MODE" != "$m" ]; then
        echo "--release and --trunk are opposite choices — pass one" >&2; exit 2
      fi
      REF_MODE="$m"; REF_FLAG=1 ;;
    # Print the header block itself: every comment line after the shebang, up to the
    # first line of code. A hardcoded line range silently truncates the moment the
    # header grows — and it grows exactly when someone documents something new,
    # which is the paragraph you would least want --help to drop.
    -h|--help) awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done
# --check is a report about what an earlier run left behind. Combined with an install flag it would
# report on a machine this same invocation is about to change — refuse rather than pick an order.
# Refuse a bad URL BEFORE anything is installed, not halfway through the run.
if [ "$NOTIFY_FLAG" = 1 ]; then
  case "$NOTIFY_URL" in
    http://*|https://*|HTTP://*|HTTPS://*) ;;
    *) echo "--notify-url must be an http(s) URL, got: '$NOTIFY_URL'" >&2; exit 2 ;;
  esac
fi
case "$REF_MODE" in
  ""|release|trunk|keep) ;;
  *) echo "COLAB_INSTALL_REF must be release, trunk or keep, got: '$REF_MODE'" >&2; exit 2 ;;
esac
if [ "$CHECK" = 1 ] && [ "$NARGS" -gt 1 ]; then
  echo "--check takes no other flag: it only reads. Run the install first, then ./install.sh --check" >&2
  exit 2
fi

have() { command -v "$1" >/dev/null 2>&1; }

# ------------------------------------------------------------------ engines --
# engines/<id>.conf is DATA: `key: value` lines, read here with sed and in --check by
# tools/lib/engines.js. Nothing below names an engine — adding one is adding a file (#530).
# No `| head -1` anywhere here: under pipefail a writer killed by SIGPIPE aborts the whole run (set -e).
conf_get() { sed -n "/^$2:/{s/^$2:[[:space:]]*//;p;q;}" "$ENGINES_DIR/$1.conf" 2>/dev/null; }
conf_all() { sed -n "s/^$2:[[:space:]]*//p" "$ENGINES_DIR/$1.conf" 2>/dev/null; }
expand_home() {
  case "$1" in
    "~") echo "$HOME" ;;
    "~/"*) echo "$HOME/${1#\~/}" ;;
    /*) echo "$1" ;;
    *) echo "$PWD/$1" ;;
  esac
}
# Engines with a fixed skills folder, in file order — `generic` (folder supplied by the user) is not one.
known_engines() {
  for f in "$ENGINES_DIR"/*.conf; do
    [ -f "$f" ] || continue
    b="$(basename "$f" .conf)"
    [ -n "$(conf_get "$b" skills_dir)" ] && echo "$b"
  done
  return 0
}
engine_dir() { expand_home "$(conf_get "$1" skills_dir)"; }
# The engine a machine with nothing linked gets: the one whose file says `default: yes` — never "the
# first file alphabetically", which would change the default the day someone adds aider.conf.
default_engine() {
  for e in $(known_engines); do [ "$(conf_get "$e" default)" = yes ] && { echo "$e"; return 0; }; done
  for e in $(known_engines); do echo "$e"; return 0; done
}
# Folders given with --skills-dir on an earlier run (one per line).
remembered_dirs() { [ -f "$SKILL_DIRS_FILE" ] && grep -v '^[[:space:]]*#' "$SKILL_DIRS_FILE" | grep -v '^[[:space:]]*$' || true; }
# dir_has_our_link <dir> — true when anything in <dir> is a symlink into this clone's skills/.
dir_has_our_link() {
  for l in "$1"/*; do
    [ -L "$l" ] || continue
    case "$(readlink "$l")" in "$SKILLS_SRC"/*) return 0 ;; esac
  done
  return 1
}

# Refuse an unknown engine BEFORE anything is installed, not halfway through the run.
if [ -n "$ENGINE_FLAG" ]; then
  for e in $(echo "$ENGINE_FLAG" | tr ',' ' '); do
    if [ ! -f "$ENGINES_DIR/$e.conf" ]; then
      echo "--engine: no engine '$e' — known: $(known_engines | tr '\n' ' ')(or --skills-dir <path> for any other)" >&2
      exit 2
    fi
    if [ -z "$(conf_get "$e" skills_dir)" ] && [ -z "$SKILLS_DIR_FLAG" ]; then
      echo "--engine $e has no skills folder of its own — pass it: --skills-dir <path>" >&2
      exit 2
    fi
  done
fi

# The oldest gh that knows issue relationships (`--json blockedBy`, sub-issues): gh v2.94.0,
# "Issue types, sub-issues, and relationships in gh issue". Measured on gh 2.45 (#521): those
# fields are unknown and `gh issue view N --comments` fails, while claims and `colab ship` work.
GH_MIN="2.94.0"

# version_ge A B — dotted numeric compare, true when A >= B. POSIX, no sort -V (absent on macOS).
version_ge() {
  a="$1"; b="$2"
  while [ -n "$a" ] || [ -n "$b" ]; do
    x="${a%%.*}"; y="${b%%.*}"
    case "$a" in *.*) a="${a#*.}" ;; *) a="" ;; esac
    case "$b" in *.*) b="${b#*.}" ;; *) b="" ;; esac
    x="${x:-0}"; y="${y:-0}"
    [ "$x" -gt "$y" ] 2>/dev/null && return 0
    [ "$x" -lt "$y" ] 2>/dev/null && return 1
  done
  return 0
}

WARNED=0
warn() { echo "  ⚠ $1"; WARNED=1; }

# ---------------------------------------------------------------- preflight --
# Reports only. Nothing here mutates anything, and nothing here exits non-zero:
# "gitleaks is missing" is a fact about a machine that may not want --hooks, not
# a failure of the run the user actually asked for.
preflight() {
  echo "preflight (checks only — nothing is changed here)"

  if have git; then
    echo "  ✓ git      $(git --version 2>/dev/null | awk '{print $3}')"
  else
    warn "git      not found — required. Install it first (macOS: xcode-select --install)."
  fi

  if have node; then
    node_v="$(node -v 2>/dev/null)"            # v22.14.0
    node_major="${node_v#v}"; node_major="${node_major%%.*}"
    echo "  ✓ node     $node_v"

    # .nvmrc is the version this repo's own CI uses; a mismatch is usually
    # harmless for the CLI (zero dependencies) but is worth knowing about.
    if [ -f "$DIR/.nvmrc" ]; then
      pinned="$(tr -d ' \t\r\n' < "$DIR/.nvmrc")"; pinned="${pinned#v}"
      if [ -n "$pinned" ] && [ "$node_major" != "${pinned%%.*}" ]; then
        warn "node major $node_major differs from .nvmrc ($pinned) — fine for the CLI,"
        echo "            but CI here runs $pinned. 'nvm use' in this clone if you hack on it."
      fi
    fi

    # engines is the real floor: below it, the CLI is not supported at all.
    engines_min="$(sed -n 's/.*"node"[[:space:]]*:[[:space:]]*">=\([0-9][0-9]*\).*/\1/p' \
      "$DIR/tools/package.json" 2>/dev/null | head -1)"
    if [ -n "$engines_min" ] && [ "$node_major" -lt "$engines_min" ] 2>/dev/null; then
      warn "node $node_v is below the colab CLI's floor (engines: >=$engines_min) — it may not run."
    fi
  else
    warn "node     not found — required by the colab CLI and the audit tool."
  fi

  if have gh; then
    gh_v="$(gh --version 2>/dev/null | sed -n '1s/^gh version \([0-9][0-9.]*\).*/\1/p')"
    if [ -n "$gh_v" ] && ! version_ge "$gh_v" "$GH_MIN"; then
      warn "gh $gh_v is below $GH_MIN — the oldest gh that reads issue relationships. Below it:"
      echo "            \`gh issue view --json blockedBy\` / \`subIssuesSummary\` are unknown fields, so"
      echo "            readiness reads blockers as unread; \`gh issue view N --comments\` (how a session"
      echo "            loads an Issue's memory) can fail with a Projects-classic GraphQL error."
      echo "            Distro packages lag — install from https://cli.github.com"
    fi
    if gh auth status >/dev/null 2>&1; then
      echo "  ✓ gh       ${gh_v:+$gh_v, }authenticated"
    else
      warn "gh       installed but NOT authenticated — run: gh auth login"
      echo "            Claims, the skills and the audit's remote targets all need it,"
      echo "            and without it they fail much later, with a confusing error."
    fi
  else
    warn "gh       not found — needed to claim issues and to audit remote repos."
    echo "            Install it, then: gh auth login"
  fi

  if have gitleaks; then
    echo "  ✓ gitleaks $(gitleaks version 2>/dev/null | head -1)"
  else
    echo "  ⚠ gitleaks not found — optional, only used by --hooks. Without it the"
    echo "            pre-commit hook installs but skips the scan (macOS: brew install gitleaks)."
  fi

  # The SECOND hooklet's dependency, reported with the same weight as the first's. It guards
  # publishing an internal name to a public repo — the mistake that cannot be recalled — and with
  # no vocabulary it warns and lets every commit through. Resolution order mirrors
  # templates/pre-commit-identity: env → git config in this clone → <COLAB_HOME>/identity-vocabulary.
  vocab="${COLAB_IDENTITY_VOCAB:-}"
  [ -n "$vocab" ] || vocab="$(git -C "$DIR" config --get colab.identityVocabulary 2>/dev/null || true)"
  [ -n "$vocab" ] || vocab="$COLAB_DIR/identity-vocabulary"
  case "$vocab" in "~/"*) vocab="$HOME/${vocab#\~/}" ;; esac
  if [ -r "$vocab" ]; then
    echo "  ✓ identity vocabulary $vocab"
  else
    echo "  ⚠ identity vocabulary not found ($vocab) — optional, only used by --hooks. Without"
    echo "            it the identity hooklet warns and lets EVERY commit through. Keep one outside"
    echo "            every repo; format: templates/identity-vocabulary.example"
  fi

  # The skills are symlinks INTO this working tree, so this clone is permanent
  # infrastructure: delete it and every session on the machine loses its skills.
  case "$DIR/" in
    /tmp/*|/private/tmp/*|/var/folders/*|"$HOME"/Downloads/*|"$HOME"/Desktop/*)
      warn "clone location looks temporary: $DIR"
      echo "            install.sh symlinks the skills INTO this working tree, so the"
      echo "            clone is permanent — move it somewhere you keep code, then re-run."
      ;;
    *)
      echo "  ✓ location $DIR"
      ;;
  esac
  echo
}

# link_dir <src> <dest> — idempotent symlink with clobber protection.
link_dir() {
  local src="$1" dest="$2" name; name="$(basename "$dest")"
  if [ -L "$dest" ]; then
    if [ "$(readlink "$dest")" = "$src" ]; then
      echo "  ✓ link-ok: $name"
      return
    fi
    # a symlink to somewhere else — someone chose that target deliberately.
    # Repointing it silently shadows their version (this bit a machine whose
    # user-level skills pointed at a richer local variant). Never touch it.
    echo "  ⚠ skip: $name is a symlink to $(readlink "$dest") (not ours) → left untouched"
    echo "          to adopt the handbook version: rm '$dest' && re-run install.sh"
    return
  fi
  if [ -e "$dest" ]; then
    # a real dir/file we did not create — never clobber it
    echo "  ⚠ skip: $name already exists and is not our symlink → left untouched ($dest)"
    return
  fi
  [ "$DRY" = 1 ] && { echo "  [dry] link: $name → $src"; return; }
  ln -s "$src" "$dest"; echo "  🔗 link: $name → $src"
}

# freeze — snapshot the CLI into <COLAB_HOME>/bin, stamped with the handbook version.
#
# The version comes from lib/stamp.js (handbookInfo), NOT from a `git describe` written out again
# here. Two implementations of "which version is this" is precisely the drift this handbook exists
# to kill, and the second one always ends up disagreeing about "behind" at the worst moment.
freeze_cli() {
  echo "frozen CLI → $FROZEN_BIN"

  if ! have node; then
    warn "node not found — cannot read the handbook version, so nothing was frozen."
    echo "            Install node and re-run: always-on services need $FROZEN_BIN."
    return
  fi

  # `version` is what we stamp, `tag` is the release it descends from; they differ when this tree is
  # ahead of the last tag. Read both, so the copy never silently claims to BE a release it is newer
  # than — see stamp.js freezeVersion.
  local desc ver tag
  desc="$(node -e 'const s=require(process.argv[1]);const f=s.freezeVersion(process.argv[2]);process.stdout.write(f.version+" "+f.tag)' \
    "$DIR/tools/lib/stamp.js" "$DIR" 2>/dev/null || true)"
  ver="${desc%% *}"
  tag="${desc##* }"
  if [ -z "$ver" ]; then
    warn "could not determine the handbook version — nothing was frozen."
    return
  fi
  if [ "$ver" = "v0" ]; then
    warn "handbook has no tags yet — freezing @ v0. Tag it, then re-run to stamp a real version."
  elif [ "$ver" != "$tag" ]; then
    warn "this tree is AHEAD of $tag — freezing @ $ver (unreleased work included).
       No version describes these bytes, so the stamp names the commit instead of overstating $tag.
       Services will run code that is in no release; re-freeze after the next tag if that matters."
  fi

  # Never clobber something we did not write. Our copy always has a STAMP beside it, so a colab in
  # this directory WITHOUT one was put there by hand (or is a symlink somebody pointed elsewhere —
  # which would defeat the whole point of a frozen copy, silently).
  if [ -e "$FROZEN_BIN" ] && [ ! -e "$FROZEN_STAMP" ]; then
    echo "  ⚠ skip: $FROZEN_BIN exists with no STAMP beside it → left untouched (not ours)"
    echo "          to adopt the frozen install: rm -rf '$FROZEN_DIR' && re-run install.sh --tools"
    return
  fi

  if [ "$DRY" = 1 ]; then
    echo "  [dry] copy: tools/colab + tools/lib/ → $FROZEN_DIR"
    echo "  [dry] stamp: # colab-handbook: colab-bin @ $ver → $FROZEN_STAMP"
    return
  fi

  # Wholesale replace, so a re-run is a true refresh and a file deleted upstream does not linger.
  # Scoped removals rather than `rm -rf $FROZEN_DIR`: COLAB_HOME is user-supplied.
  mkdir -p "$FROZEN_DIR"
  rm -rf "$FROZEN_DIR/lib"
  cp "$TOOL_SRC" "$FROZEN_BIN"
  chmod +x "$FROZEN_BIN"
  cp -R "$DIR/tools/lib" "$FROZEN_DIR/lib"
  # Tests are for the working tree; the frozen copy is a runtime, and its fixtures reference repo
  # paths that do not exist here.
  rm -f "$FROZEN_DIR"/lib/*.test.js "$FROZEN_DIR"/lib/*/*.test.js
  cp "$DIR/tools/package.json" "$FROZEN_DIR/package.json"
  printf '# colab-handbook: colab-bin @ %s\n' "$ver" > "$FROZEN_STAMP"
  echo "  ❄ froze: colab @ $ver (copy — does NOT follow this clone's branch)"
  echo "  always-on services must call this path, not ~/.local/bin/colab:"
  echo "      $FROZEN_BIN"
  echo "  refreshing it is deliberate — re-run install.sh; \`colab update\` reports when it is behind."
}

# ------------------------------------------------------------- handbook ref --
# Which version of the handbook this machine runs (#521). The skills and the PATH colab are symlinks
# into this working tree, so the checked-out ref IS the installed version. A fresh `git clone` lands
# on trunk, which on a tag-gated repo runs ahead of every final release: a first install used to stamp
# `v1.11.0-227-g…` — 227 commits of unreleased work as a newcomer's toolchain — while the npm route
# defaults to the final release. So a first install from a fresh clone pins the newest FINAL tag, and
# following trunk is an explicit choice (--trunk, the clone's @next).
#
# Every helper here reads git and nothing else; trunk is project.yml's `trunk:` (fallback main).
trunk_name() {
  t="$(sed -n 's/^trunk:[[:space:]]*\([A-Za-z0-9._/-]*\).*/\1/p' "$DIR/.github/project.yml" 2>/dev/null | head -1)"
  echo "${t:-main}"
}
newest_final_tag() {
  git -C "$DIR" tag --list 'v[0-9]*' --sort=-v:refname 2>/dev/null \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
}
# no_handbook_skill_linked — true when nothing in the skills folder is a symlink into this clone:
# the "first install on this machine" half of the auto rule. A machine that already installed keeps
# whatever ref it was on; only an explicit flag moves it.
no_handbook_skill_linked() {
  for e in $(known_engines); do dir_has_our_link "$(engine_dir "$e")" && return 1; done
  for d in $(remembered_dirs); do dir_has_our_link "$d" && return 1; done
  return 0
}

# reexec_installer — the checkout just replaced this very file under the running shell, so nothing
# after it may be read from disk: hand over to the installer AS OF the new ref, with the flags it was
# given. That installer may predate a flag (an older tag has no --notify-url) — drop it, loudly.
reexec_installer() {
  newsh="$DIR/install.sh"
  set --
  [ "$WITH_TOOLS" = 1 ] && set -- "$@" --tools
  [ "$WITH_HOOKS" = 1 ] && set -- "$@" --hooks
  [ "$WITH_FLEET" = 1 ] && set -- "$@" --fleet
  if [ -n "$ENGINE_FLAG$SKILLS_DIR_FLAG" ]; then
    if grep -q -- '--skills-dir' "$newsh"; then
      [ -n "$ENGINE_FLAG" ] && set -- "$@" --engine "$ENGINE_FLAG"
      [ -n "$SKILLS_DIR_FLAG" ] && set -- "$@" --skills-dir "$SKILLS_DIR_FLAG"
    else
      echo "  ⚠ the installer at this ref installs for Claude Code only — --engine/--skills-dir not applied;"
      echo "    re-run with --trunk to use them"
    fi
  fi
  if [ "$NOTIFY_FLAG" = 1 ]; then
    if grep -q -- '--notify-url' "$newsh"; then
      set -- "$@" --notify-url "$NOTIFY_URL"
    else
      echo "  ⚠ the installer at this ref has no --notify-url — not applied; re-run with --trunk to use it"
    fi
  fi
  echo "  → continuing with the installer as of $(git -C "$DIR" describe --tags --always 2>/dev/null)"
  echo
  COLAB_INSTALL_REEXEC=1 exec bash "$newsh" "$@"
}

# select_ref — decide, act, and always print which ref the install comes from. Exits via exec when it
# moved HEAD. Never moves a dirty tree, never moves a clone that is not a plain clone of the handbook.
select_ref() {
  echo "handbook version"
  if [ -n "${COLAB_INSTALL_REEXEC:-}" ]; then
    echo "  ✓ $(git -C "$DIR" describe --tags --always 2>/dev/null) (selected above)"
    echo; return
  fi
  # Toplevel by prefix, not by path string: $DIR is a logical path (/var/…), git's is physical (/private/var/…).
  if [ "$(git -C "$DIR" rev-parse --is-inside-work-tree 2>/dev/null)" != true ] \
    || [ -n "$(git -C "$DIR" rev-parse --show-prefix 2>/dev/null)" ]; then
    echo "  ⚠ $DIR is not a git checkout — installing these files as they are"
    echo; return
  fi
  trunk="$(trunk_name)"
  branch="$(git -C "$DIR" symbolic-ref -q --short HEAD 2>/dev/null || true)"
  mode="$REF_MODE"
  if [ -z "$mode" ]; then
    # Auto: only the exact shape of "just cloned, never installed here" — on trunk, at origin's tip,
    # no skill of ours linked. Everything else keeps its ref (a maintainer's trunk checkout, a
    # worktree on a feature branch, CI's detached checkout, a machine that chose --trunk earlier).
    if [ "$branch" = "$trunk" ] \
      && [ "$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null)" = "$(git -C "$DIR" rev-parse -q --verify "refs/remotes/origin/$trunk" 2>/dev/null)" ] \
      && no_handbook_skill_linked; then
      mode=release
      echo "  first install from a fresh clone of $trunk → pinning the newest final release"
      echo "            (follow trunk instead: re-run with --trunk; later, from a release:"
      echo "             git checkout $trunk && ./install.sh --trunk)"
    else
      mode=keep
    fi
  fi

  head="$(git -C "$DIR" rev-parse -q --verify HEAD 2>/dev/null)"
  case "$mode" in
    release)
      [ "$REF_FLAG" = 1 ] && [ "$DRY" != 1 ] && git -C "$DIR" fetch -q --tags origin 2>/dev/null
      tag="$(newest_final_tag)"
      if [ -z "$tag" ]; then
        warn "no final release tag (vX.Y.Z) here yet — installing $trunk as it is"
        echo; return
      fi
      if [ "$head" = "$(git -C "$DIR" rev-parse -q --verify "$tag^{commit}")" ]; then
        echo "  ✓ release $tag"
        echo; return
      fi
      target="$tag" ;;
    trunk)
      if [ "$branch" = "$trunk" ]; then
        echo "  ✓ trunk $trunk @ $(git -C "$DIR" describe --tags --always 2>/dev/null) — unreleased work included"
        echo; return
      fi
      target="$trunk" ;;
    keep)
      tag="$(newest_final_tag)"
      desc="$(git -C "$DIR" describe --tags --always 2>/dev/null)"
      if [ -n "$tag" ] && [ "$desc" = "$tag" ]; then
        # Spelled as git + flag: an older release's installer does not know --trunk (#521).
        echo "  ✓ release $tag (follow trunk instead: git checkout $(trunk_name) && ./install.sh --trunk)"
      else
        echo "  ✓ ${branch:-detached HEAD} @ $desc — not a final release; unreleased work is installed"
        echo "            (pin the newest final release: ./install.sh --release)"
      fi
      echo; return ;;
  esac

  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    warn "this clone has uncommitted changes — NOT switching to $target; installing what is checked out"
    echo; return
  fi
  if [ "$DRY" = 1 ]; then
    echo "  [dry] check out $target, then install from it"
    echo; return
  fi
  if [ "$target" = "$trunk" ]; then
    git -C "$DIR" fetch -q origin 2>/dev/null || true
    git -C "$DIR" checkout -q "$trunk" || { warn "could not check out $trunk — installing what is checked out"; echo; return; }
    git -C "$DIR" merge -q --ff-only "origin/$trunk" 2>/dev/null || true
  else
    git -C "$DIR" -c advice.detachedHead=false checkout -q "$target" \
      || { warn "could not check out $target — installing what is checked out"; echo; return; }
  fi
  echo "  ✓ checked out $target"
  [ "$(git -C "$DIR" rev-parse HEAD)" = "$head" ] && { echo; return; }
  reexec_installer
}

if [ "$CHECK" = 1 ]; then
  echo "== colab-handbook install --check (read-only) =="
  preflight
  echo "check"
  if ! have node; then
    echo "  ✗ node not found — the check itself needs node, as the CLI does."
    exit 1
  fi
  # The logic lives in tools/lib/install-check.js so it is unit-tested; this is only the entry.
  rc=0
  node "$DIR/tools/lib/install-check.js" --root "$DIR" --colab-home "$COLAB_DIR" --home "$HOME" || rc=$?
  echo "== done =="
  exit "$rc"
fi

# seed_state — create an EMPTY state file when none exists, through the CLI's own module so the
# shape can never drift from what the CLI writes. The CLI otherwise creates it lazily on the first
# state-changing command, so a consumer reading it on a freshly-installed machine got an error where
# it should have seen an empty fleet (#341). Exclusive create ('wx'): an existing file — somebody's
# live claims — is never touched, not even by a concurrent first write.
seed_state() {
  local f="$COLAB_DIR/state.json"
  if [ -e "$f" ]; then
    echo "  ✓ state file exists → left untouched ($f)"
    return
  fi
  if [ "$DRY" = 1 ]; then
    echo "  [dry] create empty state file: $f"
    return
  fi
  have node || return 0
  if COLAB_HOME="$COLAB_DIR" node -e '
    const fs = require("fs"); const s = require(process.argv[1]);
    fs.mkdirSync(s.COLAB_DIR, { recursive: true });
    try { fs.writeFileSync(s.STATE_FILE, JSON.stringify(s.emptyState(), null, 2) + "\n", { flag: "wx" }); }
    catch (e) { if (e.code !== "EEXIST") throw e; }' "$DIR/tools/lib/state.js"; then
    echo "  📄 state file created, empty: $f"
  else
    warn "could not create $f — the CLI creates it on its first state-changing command."
  fi
}

# seed_notify — notifyUrl is optional and off by default (#36), but a machine that runs a local
# observer depends on its pushes: some kinds (issue.merged, issue.closed, …) never reach the observer
# any other way, and an unset key there is a silent outage (#414). The logic lives in
# tools/lib/notify-endpoint.js so it is unit-tested; it ADDS each URL the key lacks — from --notify-url
# and from every line of the observers' own <COLAB_HOME>/notify-endpoint (#546) — never removing or
# rewriting an existing entry, and otherwise prints that the key is unset.
seed_notify() {
  echo "events → notifyUrl"
  if ! have node; then
    warn "node not found — notifyUrl was not checked or seeded."
    return
  fi
  # POSIX only — no arrays: CI syntax-checks this file with `sh -n`, which is dash on Linux.
  local dry=""
  [ "$DRY" = 1 ] && dry="--dry"
  if [ "$NOTIFY_FLAG" = 1 ]; then
    node "$DIR/tools/lib/notify-endpoint.js" seed --colab-home "$COLAB_DIR" --url "$NOTIFY_URL" $dry || exit $?
  else
    node "$DIR/tools/lib/notify-endpoint.js" seed --colab-home "$COLAB_DIR" $dry || exit $?
  fi
}

echo "== colab-handbook install ($([ "$DRY" = 1 ] && echo dry-run || echo apply)) =="

select_ref
preflight

# --- skills → each chosen engine's user-level folder (#530) ---
# TARGETS: one `<engine id>|<folder>` per line. POSIX only — no arrays (CI runs `sh -n` here).
TARGETS=""
add_target() {
  case "
$TARGETS
" in *"
$1|$2
"*) return 0 ;; esac
  TARGETS="${TARGETS:+$TARGETS
}$1|$2"
}
# Everything already linked: what a re-run with no flag keeps.
add_linked_targets() {
  for e in $(known_engines); do
    d="$(engine_dir "$e")"
    dir_has_our_link "$d" && add_target "$e" "$d"
  done
  for d in $(remembered_dirs); do dir_has_our_link "$d" && add_target generic "$d"; done
  return 0
}
ask_engines() {
  echo "engines — which coding agent(s) should get the skills?"
  i=0
  for e in $(known_engines); do
    i=$((i + 1)); d="$(engine_dir "$e")"; mark=""
    dir_has_our_link "$d" && mark="  (installed)"
    echo "  $i) $(conf_get "$e" label) → $d$mark"
  done
  other=$((i + 1))
  echo "  $other) other: give a path"
  add_linked_targets
  if [ -n "$TARGETS" ]; then
    dflt="what is installed"
  else
    dflt="$(known_engines | grep -nxF "$(default_engine)" | cut -d: -f1)"
  fi
  while :; do
    printf '  pick one or more (e.g. 1 or 1,%s) [Enter = %s]: ' "$other" "$dflt"
    ans=""; read -r ans || ans=""
    if [ -z "$ans" ]; then
      [ -n "$TARGETS" ] || add_target "$(default_engine)" "$(engine_dir "$(default_engine)")"
      break
    fi
    picked=""; bad=""
    for n in $(echo "$ans" | tr ',' ' '); do
      case "$n" in *[!0-9]*|"") bad="$n"; break ;; esac
      if [ "$n" -ge 1 ] && [ "$n" -lt "$other" ]; then
        picked="$picked $(known_engines | sed -n "${n}p")"
      elif [ "$n" = "$other" ]; then
        picked="$picked :other"
      else
        bad="$n"; break
      fi
    done
    [ -z "$bad" ] && break
    echo "  '$bad' is not one of 1-$other"
  done
  [ -n "$ans" ] || { echo; return 0; }
  TARGETS=""   # an explicit answer replaces the default
  for e in $picked; do
    if [ "$e" = ":other" ]; then
      printf '  skills folder for the other engine: '
      p=""; read -r p || p=""
      if [ -n "$p" ]; then add_target generic "$(expand_home "$p")"; else echo "  (no folder given — skipped)"; fi
    else
      add_target "$e" "$(engine_dir "$e")"
    fi
  done
  echo
}

if [ -n "$ENGINE_FLAG$SKILLS_DIR_FLAG" ]; then
  for e in $(echo "$ENGINE_FLAG" | tr ',' ' '); do
    [ -n "$(conf_get "$e" skills_dir)" ] && add_target "$e" "$(engine_dir "$e")"
  done
  [ -n "$SKILLS_DIR_FLAG" ] && add_target generic "$(expand_home "$SKILLS_DIR_FLAG")"
elif [ -t 0 ] && [ -t 1 ]; then
  ask_engines
else
  add_linked_targets
  if [ -z "$TARGETS" ]; then
    first="$(default_engine)"
    add_target "$first" "$(engine_dir "$first")"
    echo "engines: none had the skills linked yet → defaulted to $first ($(conf_get "$first" label))."
    echo "         Another engine: --engine <id>[,<id>] (known: $(known_engines | tr '\n' ' '| sed 's/ $//')), or --skills-dir <path>."
    echo
  fi
fi
[ -n "$TARGETS" ] || warn "no engine chosen — no skills were installed (re-run and pick one, or pass --engine)"

while IFS='|' read -r eng dest; do
  [ -n "$eng" ] || continue
  if [ "$eng" = generic ]; then label="$(conf_get generic label)"; else label="$(conf_get "$eng" label)"; fi
  echo "skills → $dest  ($label)"
  [ "$DRY" = 1 ] || mkdir -p "$dest"
  for s in "$SKILLS_SRC"/*/; do
    [ -d "$s" ] || continue
    link_dir "${s%/}" "$dest/$(basename "$s")"
  done
  echo "  invoke: $(conf_get "$eng" invoke)"
  conf_all "$eng" note | while IFS= read -r line; do echo "  note: $line"; done
  while IFS= read -r line; do [ -n "$line" ] && warn "$line"; done <<CAVEATS
$(conf_all "$eng" caveat)
CAVEATS
  # A folder engines/ does not know is remembered, so a re-run with no flag and --check find it.
  if [ "$eng" = generic ] && [ "$DRY" != 1 ] && ! remembered_dirs | grep -qxF "$dest"; then
    mkdir -p "$COLAB_DIR"; echo "$dest" >> "$SKILL_DIRS_FILE"
    echo "  remembered in $SKILL_DIRS_FILE (re-runs and --check find it there)"
  fi
done <<TARGETS_EOF
$TARGETS
TARGETS_EOF

# --- optional: colab CLI → ~/.local/bin/ ---
if [ "$WITH_TOOLS" = 1 ]; then
  echo "tools → $TOOL_DEST"
  [ "$DRY" = 1 ] || mkdir -p "$(dirname "$TOOL_DEST")"
  link_dir "$TOOL_SRC" "$TOOL_DEST"
  # Printing "make sure it is on your PATH" unconditionally taught people to
  # ignore the line. Check, and only speak up when there is something to do.
  case ":$PATH:" in
    *":$HOME/.local/bin:"*)
      echo "  ✓ ~/.local/bin is on your PATH"
      ;;
    *)
      case "$(basename "${SHELL:-}")" in
        fish) rc="$HOME/.config/fish/config.fish"
              line='fish_add_path "$HOME/.local/bin"' ;;
        bash) rc="$HOME/.bashrc"
              line='export PATH="$HOME/.local/bin:$PATH"' ;;
        *)    rc="$HOME/.zshrc"
              line='export PATH="$HOME/.local/bin:$PATH"' ;;
      esac
      warn "~/.local/bin is NOT on your PATH — 'colab' will not resolve until it is."
      echo "            Add this to $rc, then open a new shell:"
      echo
      echo "              $line"
      echo
      ;;
  esac
  freeze_cli
  seed_state
  seed_notify
else
  echo "tools: skipped (pass --tools to symlink colab onto your PATH + freeze a copy for services)"
  # An explicit --notify-url is a request in its own right; honour it without --tools.
  [ "$NOTIFY_FLAG" = 1 ] && seed_notify
fi

# --- optional: git hooks in THIS clone ---
if [ "$WITH_HOOKS" = 1 ]; then
  echo "hooks → $DIR/.githooks"
  if [ "$DRY" = 1 ]; then
    echo "  [dry] run: .githooks/install.sh (git config core.hooksPath .githooks)"
  elif [ -x "$DIR/.githooks/install.sh" ] || [ -f "$DIR/.githooks/install.sh" ]; then
    ( cd "$DIR" && sh .githooks/install.sh 2>&1 | sed 's/^/  /' ) || \
      warn "install.sh failed — see above; nothing else was affected."
  else
    warn ".githooks/install.sh not found — skipped."
  fi
  echo "  note: core.hooksPath lives in .git/config, so this is per-clone and"
  echo "        per-machine. Every clone you make needs it again."
else
  echo "hooks: skipped (pass --hooks to enable the gitleaks pre-commit hook here)"
fi

# --- optional: fleet list → ~/.colab/repos.txt ---
if [ "$WITH_FLEET" = 1 ]; then
  echo "fleet → $FLEET_DEST"
  if [ -e "$FLEET_DEST" ]; then
    # Your fleet list is hand-maintained and machine-local. Overwriting it with
    # the committed example would silently drop every repo you added.
    echo "  ✓ exists already → left untouched (never overwritten)"
  elif [ "$DRY" = 1 ]; then
    echo "  [dry] mkdir -p $COLAB_DIR"
    echo "  [dry] seed:  $FLEET_SRC → $FLEET_DEST"
  else
    mkdir -p "$COLAB_DIR"
    cp "$FLEET_SRC" "$FLEET_DEST"
    echo "  📄 seeded from audit/repos.txt — format notes and commented placeholders ONLY"
  fi
  # A seeded list registers nothing: every entry in it is a comment, so the next fleet command
  # refuses "No repos registered". Say what fills it, and prefer the command to a hand edit —
  # `colab register` writes BOTH registries (this file and config.json's repos[]) so they agree.
  echo "  register each repo (writes this list AND config.json, so the two never drift):"
  echo "      colab register /path/to/repo"
  echo "  remote-only audit target (owner/name, nothing cloned): add that line to $FLEET_DEST by hand."
else
  echo "fleet: skipped (pass --fleet to seed the audit's machine-local repo list)"
fi

# ----------------------------------------------------------------- verify ---
echo
echo "verify"
if [ "$DRY" = 1 ]; then
  echo "  [dry] nothing was changed, so there is nothing to verify."
else
  probe="$(ls "$SKILLS_SRC" 2>/dev/null | head -1)"
  while IFS='|' read -r eng dest; do
    [ -n "$eng" ] || continue
    if [ -n "$probe" ] && [ -e "$dest/$probe" ]; then
      echo "  ✓ skill '$probe' resolves at $dest/$probe"
    else
      warn "no skill resolved under $dest — see the skips above."
    fi
  done <<TARGETS_EOF
$TARGETS
TARGETS_EOF
  if [ "$WITH_TOOLS" = 1 ]; then
    if have colab; then
      echo "  ✓ colab resolves at $(command -v colab)"
    elif [ -e "$TOOL_DEST" ]; then
      warn "colab is installed at $TOOL_DEST but not on your PATH yet (see above)."
    fi
    if [ -x "$FROZEN_BIN" ]; then
      # Run the frozen copy, not the symlink: this proves the snapshot itself executes with the
      # libraries beside it, which is the only thing a service will ever depend on.
      echo "  ✓ frozen $("$FROZEN_BIN" --version 2>/dev/null || echo 'copy present but did not run')"
    fi
  fi
fi

echo
# The "next" block is a RELEASE ARTIFACT: it is what a new machine actually does after this script,
# so a new top-level command either earns a line here or is recorded in tools/lib/install-sh.test.js
# with the reason it does not. That test fails until one of the two happens (#341).
echo "next"
echo "  colab --help                    # what the CLI can do (needs --tools)"
echo "  colab register /path/to/repo    # put each repo on this machine's fleet list — nothing is registered yet"
echo "  colab adopt --repo /path/to/repo  # in a repo not yet adopted: write .github/project.yml"
echo "  colab labels --ensure --repo /path/to/repo  # create the convention labels there"
echo "  colab update                    # stamped copies behind the handbook, the frozen CLI included"
echo "  node audit/audit.mjs            # conformance report for your fleet"
echo "  ./install.sh --check            # later: is what this installed still current? (read-only)"
echo "  less CONVENTIONS.md             # the rules — ~15 minutes, the only normative file"
if [ "$WITH_TOOLS" = 1 ]; then
  echo
  echo "  two colabs, on purpose:"
  echo "    $TOOL_DEST — a symlink. Follows this clone's checked-out branch. For YOUR sessions."
  echo "    $FROZEN_BIN — a stamped copy. Never moves on its own."
  echo "  ALWAYS-ON SERVICES (launch agents, daemons, headless runners) MUST call the frozen path."
  echo "  Refresh it deliberately: re-run install.sh. \`colab update\` reports it when it is behind."
fi
[ "$WARNED" = 1 ] && echo
[ "$WARNED" = 1 ] && echo "  (some checks warned above — the install still ran; fix them when convenient)"

echo "== done =="
