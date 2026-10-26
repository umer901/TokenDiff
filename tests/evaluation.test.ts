import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluationMetrics, type EvaluationResult } from '../scripts/evaluation-metrics.js';
import { emptyCoverage } from '../src/context.js';
import { finding } from './helpers.js';

const sample: EvaluationResult = {
  fixture: 'case', repetition: 1, contextMode: 'diff', expectedCategories: ['redundant-tool-call'],
  outcome: 'completed', passed: true, elapsedMs: 100, coverage: emptyCoverage('diff'), findings: [finding],
};

test('evaluation separates misses and false positives from invalid responses and provider failures', () => {
  const { findings: _findings, ...failed } = sample;
  const metrics = evaluationMetrics([
    { ...sample, usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } },
    { ...sample, repetition: 2, findings: [], passed: false },
    { ...sample, expectedCategories: [], passed: false },
    { ...failed, outcome: 'invalid-response', passed: false, usage: { totalTokens: 25 } },
    { ...failed, outcome: 'provider-error', passed: false },
    { ...failed, outcome: 'incomplete-response', passed: false },
  ]);
  assert.equal(metrics.categoryTruePositives, 1);
  assert.equal(metrics.categoryMisses, 1);
  assert.equal(metrics.categoryFalsePositives, 1);
  assert.equal(metrics.invalidResponses, 1);
  assert.equal(metrics.providerErrors, 1);
  assert.equal(metrics.incompleteResponses, 1);
  assert.equal(metrics.evidenceValidityRate, 3 / 4);
  assert.equal(metrics.totalElapsedMs, 600);
  assert.deepEqual(metrics.reportedUsage, { inputTokens: 50, outputTokens: 10, totalTokens: 85 });
  assert.equal(metrics.usageReportedRuns, 2);
});

test('empty evaluation cannot imply successful evidence validation or zero measured token usage', () => {
  assert.equal(evaluationMetrics([]).evidenceValidityRate, null);
  assert.deepEqual(evaluationMetrics([]).reportedUsage, {});
});
