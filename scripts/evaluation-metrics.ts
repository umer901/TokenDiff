import type { Coverage, Finding, ReviewDiagnostics, Usage } from '../src/types.js';

export interface EvaluationResult {
  fixture: string;
  repetition: number;
  contextMode: string;
  expectedCategories: string[];
  outcome: 'completed' | 'invalid-response' | 'incomplete-response' | 'provider-error';
  passed: boolean;
  elapsedMs: number;
  coverage: Coverage;
  guidance?: import('../src/knowledge/retrieve.js').GuidanceCoverage;
  findings?: Finding[];
  usage?: Usage;
  diagnostics?: ReviewDiagnostics;
  error?: string;
}

export function evaluationMetrics(results: EvaluationResult[]) {
  const completed = results.filter(r => r.outcome === 'completed');
  const invalid = results.filter(r => r.outcome === 'invalid-response').length;
  let truePositives = 0, falsePositives = 0, misses = 0;
  for (const result of completed) {
    const actual = new Set(result.findings?.map(f => f.category) ?? []);
    truePositives += result.expectedCategories.filter(c => actual.has(c as Finding['category'])).length;
    misses += result.expectedCategories.filter(c => !actual.has(c as Finding['category'])).length;
    falsePositives += [...actual].filter(c => !result.expectedCategories.includes(c)).length;
  }
  const reportedUsage: Usage = {};
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
    const values = results.flatMap(r => r.usage?.[key] === undefined ? [] : [r.usage[key]]);
    if (values.length) reportedUsage[key] = values.reduce((a, b) => a + b, 0);
  }
  return {
    attempted: results.length, completed: completed.length,
    categoryMatches: completed.filter(r => r.passed).length,
    categoryTruePositives: truePositives, categoryFalsePositives: falsePositives, categoryMisses: misses,
    invalidResponses: invalid, incompleteResponses: results.filter(r => r.outcome === 'incomplete-response').length,
    providerErrors: results.filter(r => r.outcome === 'provider-error').length,
    evidenceValidityRate: completed.length + invalid ? completed.length / (completed.length + invalid) : null,
    totalElapsedMs: results.reduce((sum, r) => sum + r.elapsedMs, 0),
    usageReportedRuns: results.filter(r => r.usage !== undefined).length, reportedUsage,
  };
}
