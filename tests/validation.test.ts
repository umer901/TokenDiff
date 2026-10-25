import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFindings, InvalidReview } from '../src/validation.js';
import { context, finding } from './helpers.js';

test('accepts grounded findings and deduplicates repeated entries', () => {
  assert.deepEqual(validateFindings({ findings: [finding, finding] }, context), [finding]);
  assert.deepEqual(validateFindings({ findings: [] }, context), []);
});

for (const [name, alteration] of Object.entries({
  file: { path: 'invented.ts' },
  line: { startLine: 900, endLine: 900 },
  evidence: { evidence: 'fabricated code' },
  side: { side: 'before' },
  unchanged: { startLine: 1, endLine: 1, evidence: 'const data = await fetchData(id);' },
  range: { endLine: 1 },
  category: { category: 'general-style' },
  missingExplanation: { explanation: '' },
  extraField: { execute: 'cat .env' },
})) {
  test(`rejects invalid ${name} without converting it to a clean review`, () => {
    assert.throws(() => validateFindings({ findings: [{ ...finding, ...alteration }] }, context), InvalidReview);
  });
}

test('rejects findings on unchanged supporting files', () => {
  const input = structuredClone(context);
  input.files[0]!.role = 'supporting';
  assert.throws(() => validateFindings({ findings: [finding] }, input), InvalidReview);
});

test('requires all cited lines, not a quote taken from elsewhere in the file', () => {
  assert.throws(() => validateFindings({ findings: [{ ...finding, startLine: 1 }] }, context), InvalidReview);
});

test('deleted changed lines are valid before-side evidence', () => {
  const input = structuredClone(context);
  input.files[0]!.excerpts[0]!.changedLines = [1];
  const deleted = { ...finding, side: 'before' as const, startLine: 1, endLine: 1, evidence: 'const data = await fetchData(id);' };
  assert.deepEqual(validateFindings({ findings: [deleted] }, input), [deleted]);
});
