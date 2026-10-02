'use strict';
// #431: a registry install has no git of its own — handbookInfo must read the package version
// instead of reporting `v0` (which would stamp every adopter's copied files `v0`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stamp = require('./stamp.js');

function pkgDir(pkg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-pkg-'));
  if (pkg !== null) fs.writeFileSync(path.join(d, 'package.json'), pkg);
  return d;
}

test('no git, package.json carries a version -> that version', () => {
  const d = pkgDir(JSON.stringify({ name: 'x', version: '1.12.0' }));
  const hb = stamp.handbookInfo(d);
  assert.strictEqual(hb.version, 'v1.12.0');
  assert.strictEqual(hb.untagged, false);
  assert.strictEqual(hb.hasGit, false);
});

test('no git, no version in package.json -> v0 as before', () => {
  assert.strictEqual(stamp.handbookInfo(pkgDir(JSON.stringify({ name: 'x' }))).version, 'v0');
  assert.strictEqual(stamp.handbookInfo(pkgDir(null)).version, 'v0');
  assert.strictEqual(stamp.handbookInfo(pkgDir('{not json')).version, 'v0');
});
