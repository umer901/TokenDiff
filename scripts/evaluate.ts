import { fixtureContext, loadFixtures } from './fixtures.js';
import { readConfig } from '../src/config.js';
import { createTransport, ProviderFailure, review } from '../src/providers.js';
import { writeFile } from 'node:fs/promises';
import type { Finding, Usage } from '../src/types.js';
import { redact } from '../src/report.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const values: Record<string, string> = {
    provider: process.env.TOKENDIFF_PROVIDER ?? (dryRun ? 'gemini' : ''),
    model: process.env.TOKENDIFF_MODEL ?? (dryRun ? 'fixture-only' : ''),
    'api-key': dryRun ? '' : process.env.TOKENDIFF_API_KEY ?? '',
    'github-token': 'unused-for-fixtures',
  };
  if (!dryRun && !values['api-key']) throw new Error('Set TOKENDIFF_PROVIDER, TOKENDIFF_MODEL, and TOKENDIFF_API_KEY, or use --dry-run. Live evaluation sends synthetic fixtures to the selected provider and can incur charges.');
  const config = readConfig(key => values[key] ?? '');
  const only = process.argv.find(arg => arg.startsWith('--fixture='))?.slice('--fixture='.length);
  const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice('--report='.length);
  const fixtures = (await loadFixtures()).filter(f => !only || f.id === only);
  if (!fixtures.length) throw new Error('No fixture matches the requested ID.');
  const results: Array<{ fixture: string; expectedCategories: string[]; passed: boolean; findings?: Finding[]; usage?: Usage; error?: string }> = [];
  const saveReport = async () => {
    if (reportPath && !dryRun) await writeFile(reportPath, JSON.stringify(redact({
      provider: config.provider, model: config.model, results,
    }, [config.apiKey]), null, 2), { mode: 0o600 });
  };
  let passed = 0;
  for (const fixture of fixtures) {
    const { context, coverage } = await fixtureContext(fixture, config);
    if (dryRun) {
      console.log(`${fixture.id}: ${coverage.contextChars} context characters; expected ${fixture.expectedCategories.join(', ') || 'no findings'}`);
      continue;
    }
    try {
      const result = await review(context, createTransport(config));
      const actual = [...new Set(result.findings.map(f => f.category))].sort();
      const pass = JSON.stringify(actual) === JSON.stringify([...fixture.expectedCategories].sort());
      results.push({ fixture: fixture.id, expectedCategories: fixture.expectedCategories, passed: pass, findings: result.findings, ...(result.usage ? { usage: result.usage } : {}) });
      if (pass) passed++;
      console.log(`${pass ? 'PASS' : 'FAIL'} ${fixture.id}: ${actual.join(', ') || 'no findings'}`);
    } catch (error) {
      const message = error instanceof ProviderFailure ? error.message : 'Review unavailable.';
      results.push({ fixture: fixture.id, expectedCategories: fixture.expectedCategories, passed: false, error: message });
      console.log(`ERROR ${fixture.id}: ${message}`);
      await saveReport();
      if (/quota or rate limit/.test(message)) {
        console.log('Stopping live evaluation after provider quota exhaustion; remaining fixtures were not run.');
        break;
      }
    }
    await saveReport();
  }
  if (!dryRun) {
    console.log(`${passed}/${results.length} attempted fixtures matched expected categories (${fixtures.length} selected). Inspect findings before drawing quality conclusions.`);
    if (passed !== fixtures.length) process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
});
