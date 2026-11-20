'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { audit } = require('../src/guard.cjs');

const withdrawnOn = '2026-02-28';
const listing = (id, status = 'listed') => ({ id, status });
const entry = (id, extra = {}) => ({ id, withdrawnOn, ...extra });
const fixtures = path.join(__dirname, '..', 'examples');

test('classifies missing, previously hidden and already public IDs', () => {
  const ids = ['C-3', 'A-1', 'B-2'];
  const rows = audit(
    ids.map(id => listing(id)),
    ids.map(id => entry(id)),
    [listing('B-2', 'draft'), listing('C-3', 'reserved')]
  );
  assert.deepEqual(rows.map(({ id, kind }) => [id, kind]), [
    ['A-1', 'reappeared'], ['B-2', 'reappeared'], ['C-3', 'already-public']
  ]);
});

test('allows new, omitted, non-public and explicitly reinstated listings', () => {
  assert.deepEqual(audit(
    [listing('NEW'), listing('W', 'withdrawn'), listing('D', 'draft'), listing('R', 'reserved')],
    [entry('W'), entry('D'), entry('OMITTED'), entry('R', { reinstatedOn: withdrawnOn })]
  ), []);
});

test('protects public states without a previous snapshot', () => {
  assert.deepEqual(audit([listing('A', 'reserved')], [entry('A')]), [
    { id: 'A', kind: 'public', status: 'reserved', withdrawnOn }
  ]);
});

test('treats IDs as exact strings, including prefixes and leading zeroes', () => {
  assert.deepEqual(audit([listing('001'), listing('TH:1'), listing('th:1')],
    [entry('1'), entry('TH:1')]).map(row => row.id), ['TH:1']);
});

test('rejects duplicate IDs in each input', () => {
  assert.throws(() => audit([listing('A'), listing('A')], []), /Current snapshot row 2.*duplicate/);
  assert.throws(() => audit([], [entry('A'), entry('A')]), /Withdrawal register row 2.*duplicate/);
  assert.throws(() => audit([], [], [listing('A'), listing('A')]), /Previous snapshot row 2.*duplicate/);
});

test('rejects invalid shapes, states, unsafe IDs and malformed dates', () => {
  assert.throws(() => audit({}, []), /must be an array/);
  assert.throws(() => audit([null], []), /listing ID/);
  assert.throws(() => audit([listing('123', 'sold')], []), /status/);
  assert.throws(() => audit([listing('a|b')], []), /listing ID/);
  assert.throws(() => audit([listing(123)], []), /listing ID/);
  assert.throws(() => audit([], [entry('A', { withdrawnOn: '2026-02-30' })]), /withdrawnOn/);
  assert.throws(() => audit([], [entry('A', { reinstatedOn: '2026-02-27' })]), /reinstatedOn/);
  assert.throws(() => audit([], [entry('A', { reinstatedOn: null })]), /reinstatedOn/);
});

function launch(t, overrides = {}, files = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.WITHDRAWAL_GUARD_TEST_TMP || os.tmpdir(), 'listing-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'output.txt');
  const summary = path.join(dir, 'summary.md');
  for (const name of ['clean', 'candidate', 'previous', 'withdrawals']) {
    fs.copyFileSync(path.join(fixtures, `${name}.json`), path.join(dir, `${name}.json`));
  }
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  const action = path.join(__dirname, '../src/action.cjs');
  const result = spawnSync(process.execPath, [action], {
    env: {
      ...process.env,
      GITHUB_WORKSPACE: dir,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      INPUT_CURRENT: 'candidate.json',
      INPUT_WITHDRAWALS: 'withdrawals.json',
      INPUT_PREVIOUS: 'previous.json',
      ...overrides
    },
    encoding: 'utf8'
  });
  return {
    ...result,
    output: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : ''
  };
}

test('action entry point fails, annotates, and reports counts and affected IDs', t => {
  const result = launch(t);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /::error title=Withdrawn listings in public export/);
  assert.match(result.stdout, /SEA-101: reappeared/);
  assert.match(result.stdout, /SEA-102: already-public/);
  assert.equal(result.output, 'violation-count=2\nreappeared-count=1\n');
  assert.match(result.summary, /SEA-101.*2026-01-14/);
  assert.doesNotMatch(result.summary, /synthetic payload|SEA-103/);
});

test('action entry point passes a clean candidate with optional baseline omitted', t => {
  const result = launch(t, { INPUT_CURRENT: 'clean.json', INPUT_PREVIOUS: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'violation-count=0\nreappeared-count=0\n');
  assert.match(result.summary, /No withdrawn listings in public states/);
});

test('invalid JSON and path traversal fail without disclosing the input', t => {
  const malformed = launch(t, {}, { 'candidate.json': 'synthetic payload' });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /Current snapshot is not valid JSON/);
  assert.doesNotMatch(malformed.stderr, /synthetic payload/);
  const escaped = launch(t, { INPUT_CURRENT: '../' });
  assert.equal(escaped.status, 2);
  assert.match(escaped.stderr, /must resolve inside the workspace/);
});

test('action accepts UTF-8 BOM and caps reported rows while preserving totals', t => {
  const ids = Array.from({ length: 51 }, (_, index) => `UNIT-${100 + index}`);
  const result = launch(t, { INPUT_PREVIOUS: '' }, {
    'candidate.json': '\uFEFF' + JSON.stringify(ids.map(id => listing(id))),
    'withdrawals.json': JSON.stringify(ids.map(id => entry(id)))
  });
  assert.equal(result.status, 1);
  assert.equal(result.output, 'violation-count=51\nreappeared-count=0\n');
  assert.match(result.summary, /1 more finding/);
  assert.doesNotMatch(result.summary, /UNIT-150/);
});
