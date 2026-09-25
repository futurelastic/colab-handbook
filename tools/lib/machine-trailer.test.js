'use strict';
/** #367: unit tests for tools/lib/machine-trailer.js — pure, no git, no network. */
const test = require('node:test');
const assert = require('node:assert');
const { decide, adoptedTrailer } = require('./machine-trailer');

test('public forge → omitted, whatever the room says', () => {
  for (const room of [null, 'solo', 'team', 'public']) {
    const d = decide({ label: 'box-a', visibility: 'PUBLIC', room });
    assert.strictEqual(d.include, false);
    assert.strictEqual(d.line, null);
    assert.strictEqual(d.failClosed, false);
  }
});

test('room: public → omitted even when the forge reads private', () => {
  const d = decide({ label: 'box-a', visibility: 'PRIVATE', room: 'public' });
  assert.strictEqual(d.include, false);
  assert.match(d.reason, /room: public/);
});

test('private / internal forge → Machine: <label>, unchanged from #350', () => {
  for (const visibility of ['PRIVATE', 'private', 'INTERNAL']) {
    const d = decide({ label: 'box-a', visibility, room: undefined });
    assert.strictEqual(d.include, true);
    assert.strictEqual(d.line, 'Machine: box-a');
  }
});

test('unreadable forge: a declared private room keeps it; no room fails closed', () => {
  assert.strictEqual(decide({ label: 'box-a', visibility: null, room: 'team' }).line, 'Machine: box-a');
  assert.strictEqual(decide({ label: 'box-a', visibility: null, room: 'solo' }).line, 'Machine: box-a');
  const closed = decide({ label: 'box-a', visibility: null, room: null });
  assert.strictEqual(closed.include, false);
  assert.strictEqual(closed.failClosed, true);
  const odd = decide({ label: 'box-a', visibility: 'SOMETHING', room: null });
  assert.strictEqual(odd.failClosed, true);
});

test('private repo but no derivable label → no line, not a fail-closed', () => {
  const d = decide({ label: null, visibility: 'PRIVATE', room: null });
  assert.strictEqual(d.include, false);
  assert.strictEqual(d.failClosed, false);
  assert.match(d.reason, /no machine label/);
});

test('adoptedTrailer keeps branch + sha always, host tail only where Machine: may be written', () => {
  const adopt = { branch: 'chore/x', remoteSha: 'abc123', host: 'box-a.lan', machine: 'M1' };
  assert.strictEqual(adoptedTrailer(adopt, decide({ label: 'box-a', visibility: 'PUBLIC', room: null })),
    'Colab-Adopted: origin/chore/x @ abc123');
  assert.strictEqual(adoptedTrailer(adopt, decide({ label: 'box-a', visibility: 'PRIVATE', room: null })),
    'Colab-Adopted: origin/chore/x @ abc123 on box-a.lan (machine M1)');
  assert.strictEqual(adoptedTrailer(null, null), null);
});

test('#301: the Colab-Adopted: trailer names the remote the branch was adopted from; absent, origin as before', () => {
  assert.strictEqual(adoptedTrailer({ branch: 'chore/x', remoteSha: 'abc123', remote: 'upstream' }, null), 'Colab-Adopted: upstream/chore/x @ abc123');
  assert.strictEqual(adoptedTrailer({ branch: 'chore/x', remoteSha: 'abc123' }, null), 'Colab-Adopted: origin/chore/x @ abc123');
});
