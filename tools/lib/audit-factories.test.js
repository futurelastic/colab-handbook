'use strict';
/**
 * #739: the audit validates `.github/factories.yml` (audit/audit.mjs). Absent is clean and reported
 * as null; a valid file is clean and reports its factory ids; an invalid one fails with each
 * validator finding — every reader treats an invalid file as "nobody", so only the audit can say so.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIT = path.join(path.resolve(__dirname, '..', '..'), 'audit', 'audit.mjs');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const KEY = (c) => `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${c.repeat(43)}`;
const VALID = [
  'version: 1', 'steward: core', 'forge: github.com', 'factories:',
  '  core:', '    tier: steward', '    machines: [box-a]', `    key: ${KEY('A')}`, '    humans: [operator-a]', '    slices: [slice:core]',
  '  mobile:', '    tier: partner', '    machines: [mobile-1]', `    key: ${KEY('B')}`, '    slices: [slice:mobile]',
  'steward-areas: [CONVENTIONS.md]', '',
].join('\n');

function fixture(factoriesYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-factories-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), BASE);
  if (factoriesYml !== null) fs.writeFileSync(path.join(dir, '.github', 'factories.yml'), factoriesYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return {
    v: r.factories,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text).filter((t) => /factories\.yml/.test(t)),
  };
}

test('#739 absent → null, no finding', () => {
  const r = audit(fixture(null));
  assert.strictEqual(r.v, null);
  assert.deepStrictEqual(r.fails, []);
});

test('#739 a valid file → its factory ids, no finding', () => {
  const r = audit(fixture(VALID));
  assert.deepStrictEqual(r.fails, []);
  assert.deepStrictEqual(r.v, ['core', 'mobile']);
});

test('#739 a machine in two factories fails the audit, naming both', () => {
  const r = audit(fixture(VALID.replace('machines: [mobile-1]', 'machines: [mobile-1, box-a]')));
  assert.strictEqual(r.v, null);
  assert.ok(r.fails.some((t) => /machine `box-a` is claimed by both `core` and `mobile`/.test(t)), r.fails.join('\n'));
});
