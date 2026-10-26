// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { fixtureContext, loadFixtures } from './fixtures.js';
import { readConfig } from '../src/config.js';
import { createTransport, ProviderFailure, review } from '../src/providers.js';
import { writeFile } from 'node:fs/promises';
import { redact } from '../src/report.js';
import { evaluationMetrics, type EvaluationResult } from './evaluation-metrics.js';

async function main() {
  const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dryRun = process.argv.includes('--dry-run');
  const repeats = Number(arg('repeat') ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeat must be an integer from 1 to 10.');
  const mode = arg('context-mode') ?? 'diff';
  if (!['diff', 'repository', 'both'].includes(mode)) throw new Error('--context-mode must be diff, repository, or both.');
  const modes = mode === 'both' ? ['diff', 'repository'] : [mode];
  const values: Record<string, string> = {
    provider: process.env.TOKENDIFF_PROVIDER ?? (dryRun ? 'gemini' : ''),
    model: process.env.TOKENDIFF_MODEL ?? (dryRun ? 'fixture-only' : ''),
    'api-key': dryRun ? '' : process.env.TOKENDIFF_API_KEY ?? '',
    'github-token': 'unused-for-fixtures',
  };
  if (!dryRun && !values['api-key']) throw new Error('Set TOKENDIFF_PROVIDER, TOKENDIFF_MODEL, and TOKENDIFF_API_KEY, or use --dry-run. Live evaluation sends synthetic fixtures to the selected provider and can incur charges.');
  const config = readConfig(key => values[key] ?? '');
  const fixtures = (await loadFixtures()).filter(f => !arg('fixture') || f.id === arg('fixture'));
  if (!fixtures.length) throw new Error('No fixture matches the requested ID.');
  const results: EvaluationResult[] = [];
  const selected = fixtures.length * repeats * modes.length;
  const saveReport = async () => {
    if (arg('report') && !dryRun) await writeFile(arg('report')!, JSON.stringify(redact({
      provider: config.provider, model: config.model, selected, unattempted: selected - results.length,
      metrics: evaluationMetrics(results), results,
    }, [config.apiKey]), null, 2), { mode: 0o600 });
  };
  runs: for (let repetition = 1; repetition <= repeats; repetition++) {
    for (const contextMode of modes) {
      for (const fixture of fixtures) {
        const caseConfig = readConfig(key => key === 'context-mode' ? contextMode : values[key] ?? '');
        const { context, coverage } = await fixtureContext(fixture, caseConfig);
        const label = `${fixture.id} [${contextMode}, run ${repetition}]`;
        if (dryRun) {
          console.log(`${label}: ${coverage.contextChars} context characters; expected ${fixture.expectedCategories.join(', ') || 'no findings'}`);
          continue;
        }
        const started = Date.now();
        const base = { fixture: fixture.id, repetition, contextMode, expectedCategories: fixture.expectedCategories, coverage };
        try {
          const result = await review(context, createTransport(caseConfig));
          const actual = [...new Set(result.findings.map(f => f.category))].sort();
          const passed = JSON.stringify(actual) === JSON.stringify([...fixture.expectedCategories].sort());
          results.push({ ...base, outcome: 'completed', passed, elapsedMs: Date.now() - started, ...result });
          console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: ${actual.join(', ') || 'no findings'}`);
        } catch (error) {
          const failure = error instanceof ProviderFailure ? error : new ProviderFailure('Review unavailable.');
          const last = failure.diagnostics?.attempts.at(-1);
          const outcome = last?.outcome === 'invalid-response' || last?.outcome === 'incomplete-response' ? last.outcome : 'provider-error';
          results.push({ ...base, outcome, passed: false, elapsedMs: Date.now() - started, error: failure.message,
            ...(failure.guidance ? { guidance: failure.guidance } : {}),
            ...(failure.usage ? { usage: failure.usage } : {}), ...(failure.diagnostics ? { diagnostics: failure.diagnostics } : {}) });
          console.log(`ERROR ${label}: ${failure.message}`);
          await saveReport();
          if (last && ['quota-exhausted', 'quota-or-rate-limit', 'rate-limited', 'retry-delay-exceeds-limit'].includes(last.reason)) {
            console.log('Stopping live evaluation after a quota/rate limit or excessive retry delay; remaining cases were not run.');
            break runs;
          }
        }
        await saveReport();
      }
    }
  }
  if (!dryRun) {
    const metrics = evaluationMetrics(results);
    console.log(`${metrics.categoryMatches}/${results.length} attempted cases matched expected categories (${selected} selected). Inspect findings before drawing quality conclusions.`);
    console.log(JSON.stringify(metrics));
    if (metrics.categoryMatches !== selected) process.exitCode = 1;
  }
}

main().catch(() => {
  // Do not emit raw filesystem/SDK errors, which may include supplied arguments.
  console.error('Evaluation failed. Check provider/model/key, --fixture, --repeat (1–10), --context-mode (diff/repository/both), and report destination.');
  process.exitCode = 1;
});
