// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFindings, InvalidReview } from '../src/validation.js';
import { excerptId, serializeContext } from '../src/context-format.js';
import { context, finding, proposal } from './helpers.js';

test('constructs exact evidence from supplied source and deduplicates repeated ranges', () => {
  assert.deepEqual(validateFindings({ findings: [proposal(), proposal()] }, context), [finding]);
  assert.deepEqual(validateFindings({ findings: [] }, context), []);
});

for (const [name, alteration] of Object.entries({
  excerpt: { excerptId: 'invented' },
  line: { startLine: 900, endLine: 900 },
  evidence: { evidence: 'fabricated code' },
  side: { side: 'before' },
  path: { path: 'elsewhere.ts' },
  unchanged: { startLine: 1, endLine: 1 },
  range: { endLine: 1 },
  category: { category: 'general-style' },
  missingExplanation: { explanation: '' },
  extraField: { execute: 'cat .env' },
})) {
  test(`rejects invalid ${name} without converting it to a clean review`, () => {
    assert.throws(() => validateFindings({ findings: [{ ...proposal(), ...alteration }] }, context), InvalidReview);
  });
}

test('rejects findings on unchanged supporting files and same-file helpers', () => {
  const input = structuredClone(context);
  input.files[0]!.role = 'supporting';
  assert.throws(() => validateFindings({ findings: [proposal()] }, input), InvalidReview);
  input.files[0]!.role = 'changed';
  input.files[0]!.excerpts[1]!.changedLines = [];
  assert.throws(() => validateFindings({ findings: [proposal()] }, input), /range-without-changes/);
});

test('a valid finding cannot conceal another fabricated location', () => {
  assert.throws(() => validateFindings({ findings: [proposal(), { ...proposal(), excerptId: 'fake' }] }, context), /unknown-excerpt/);
});

test('deleted changed lines are valid before-side evidence', () => {
  const input = structuredClone(context);
  input.files[0]!.excerpts[0]!.changedLines = [1];
  const deleted = { ...finding, side: 'before' as const, startLine: 1, endLine: 1, evidence: 'const data = await fetchData(id);' };
  const { path: _path, side: _side, evidence: _evidence, references: _references, ...rest } = deleted;
  assert.deepEqual(validateFindings({ findings: [{ ...rest, excerptId: excerptId(input.files[0]!, input.files[0]!.excerpts[0]!) }] }, input), [deleted]);
});

test('line labels and IDs are stable and evidence uses the selected range, including indentation', () => {
  const input = structuredClone(context);
  const excerpt = input.files[0]!.excerpts[1]!;
  excerpt.startLine = 315;
  excerpt.lines = ['    result = await bridge.call(call.name, arguments)', '    result = await bridge.call(call.name, arguments)', '    audit.append(result)', '    unrelated = True'];
  excerpt.changedLines = [316];
  const wire = JSON.parse(serializeContext(input));
  const id = wire.files[0].excerpts[1].id;
  assert.equal(wire.files[0].excerpts[1].lines[0].line, 315);
  assert.equal(id, JSON.parse(serializeContext(input)).files[0].excerpts[1].id);
  const [result] = validateFindings({ findings: [{ ...proposal(), excerptId: id, startLine: 315, endLine: 317 }] }, input);
  assert.equal(result!.evidence, excerpt.lines.slice(0, 3).join('\n'));
  assert.equal(result!.evidence.includes('unrelated'), false);
  assert.throws(() => validateFindings({ findings: [{ ...proposal(), excerptId: id, startLine: 315, endLine: 323 }] }, input), /range-outside-excerpt/);
});
