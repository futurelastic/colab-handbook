'use strict';
/**
 * #525 — the human door on `colab ship`'s autonomy gate.
 *
 * Without `autonomy: auto-trunk` the gate used to have two answers: docs-only (#345) or refuse.
 * The refusal said "a human must trigger Phase B", but refused that human too, so on the default
 * (`manual`) repo the person meant to give the go had no tool to give it with. Ruling on #525
 * (option 1): a person running `colab ship` IS the go, measured on the bar the CLI already applies
 * to human-only acts (`colab adopt --autonomy`, `colab release finalize`):
 *
 *   - an interactive terminal (stdin AND stdout a TTY) outside an agent shell, confirmed by typing
 *     at the prompt — `how: 'tty'`; or
 *   - `COLAB_HUMAN=1` AND `--answered-by <name>` — `how: 'colab-human'`.
 *
 * An agent never passes on its own: an agent shell (`CLAUDECODE=1` / `AI_AGENT`, the signals
 * `lib/place.js` already reads) does not count as a terminal, and setting `COLAB_HUMAN=1` is
 * governed by the handbook's existing rule — never on the agent's own say-so.
 *
 * Pure: every input is passed in, so the TTY branch is unit-testable without a pty.
 */

/** Is this process running inside an agent's shell? Same signals as lib/place.js rule 3. */
function isAgentShell(env) {
  return env.CLAUDECODE === '1' || !!env.AI_AGENT;
}

/**
 * @returns {{ open: boolean, how: 'tty'|'colab-human'|null, why: string }}
 */
function humanDoorVerdict({ isTTY, colabHuman, answeredBy, agentShell }) {
  if (colabHuman && answeredBy) {
    return { open: true, how: 'colab-human', why: `COLAB_HUMAN=1, answered by ${answeredBy}` };
  }
  if (colabHuman && !answeredBy) {
    return { open: false, how: null, why: 'COLAB_HUMAN=1 also needs --answered-by "<name>"' };
  }
  if (isTTY && !agentShell) {
    return { open: true, how: 'tty', why: 'a person at an interactive terminal' };
  }
  if (isTTY && agentShell) {
    return { open: false, how: null, why: 'an agent shell is not a person at a terminal' };
  }
  return { open: false, how: null, why: 'unattended (no interactive terminal, no COLAB_HUMAN=1)' };
}

/** Read the door's inputs from a real process. */
function humanDoorFromProcess(proc, answeredBy) {
  return humanDoorVerdict({
    isTTY: !!(proc.stdin.isTTY && proc.stdout.isTTY),
    colabHuman: proc.env.COLAB_HUMAN === '1',
    answeredBy: answeredBy || null,
    agentShell: isAgentShell(proc.env),
  });
}

/**
 * The exact commands a human runs, for the refusal. `target` is the ship selector the caller
 * used (`--worktree x`, `--branch y`, `--direct`), so the line can be pasted as it stands.
 */
function humanDoorCommands(selector) {
  const sel = selector ? ` ${selector}` : '';
  return [
    `at your own terminal:  colab ship${sel}          (asks you to confirm)`,
    `or, non-interactive:   COLAB_HUMAN=1 colab ship${sel} --answered-by "<your name>"`,
  ];
}

/** The clause the 🚢 / ✅ evidence comment carries when the human door opened the gate. */
function humanDoorEvidence(door) {
  if (!door || !door.open) return '';
  return door.how === 'tty'
    ? ' · merged through the human door (#525): a person confirmed at an interactive terminal'
    : ` · merged through the human door (#525): ${door.why}`;
}

module.exports = { isAgentShell, humanDoorVerdict, humanDoorFromProcess, humanDoorCommands, humanDoorEvidence };
