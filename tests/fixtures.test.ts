import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureContext, loadFixtures } from '../scripts/fixtures.js';
import { validateFindings } from '../src/validation.js';
import { excerptId } from '../src/context-format.js';
import { config } from './helpers.js';

test('multilingual positive and negative fixtures produce valid, bounded comparison contexts', async () => {
  const fixtures = await loadFixtures();
  assert.equal(fixtures.length, 19);
  for (const fixture of fixtures) {
    const { context, coverage } = await fixtureContext(fixture, config);
    assert.equal(context.files.length, 1, fixture.id);
    assert.equal(coverage.omittedFiles.length, 0, fixture.id);
    assert.ok(coverage.contextChars <= config.maxContextChars);
    assert.ok(context.files[0]!.excerpts.some(e => e.changedLines.length > 0));
    if (!fixture.expectedCategories.length) {
      assert.deepEqual(validateFindings({ findings: [] }, context), []);
      continue;
    }
    const excerpt = context.files[0]!.excerpts.find(e => e.side === 'after' && e.changedLines.length)
      ?? context.files[0]!.excerpts.find(e => e.changedLines.length)!;
    const line = excerpt.changedLines[0]!;
    const findings = [{
      category: fixture.expectedCategories[0], severity: 'medium', confidence: 'high', excerptId: excerptId(context.files[0]!, excerpt),
      startLine: line, endLine: line,
      explanation: 'Introduced duplicate work.', impact: 'May consume additional context.', suggestion: 'Reuse existing work.',
      tradeoff: 'Check freshness and semantic equivalence.', verification: 'Compare outputs and call traces.', techniqueIds: ['reuse-or-compute'],
    }];
    assert.equal(validateFindings({ findings }, context).length, 1);
  }
});
