// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { emptyCoverage } from '../src/context.js';
import { plain, redact, renderReport } from '../src/report.js';
import type { Report } from '../src/types.js';
import { finding, pr, runtime } from './helpers.js';

test('defaults and explicit context settings are validated', () => {
  assert.equal(readConfig(runtime().api.input).maxContextChars, 60_000);
  assert.equal(readConfig(runtime().api.input).maxOutputTokens, 4096);
  assert.equal(readConfig(runtime().api.input).contextMode, 'diff');
  assert.equal(readConfig(runtime({ 'context-mode': 'repository' }).api.input).contextMode, 'repository');
  for (const inputs of [{ 'max-context-chars': 'abc' }, { 'max-context-chars': '999' }, { 'max-output-tokens': '999999999' }, { 'context-mode': 'full' }, { include: '!**/*.md' }, { model: '' }]) {
    assert.throws(() => readConfig(runtime(inputs).api.input));
  }
});

function report(): Report {
  return { schemaVersion: 1, status: 'completed', reason: 'Review complete.', provider: 'gemini', model: 'test', workflowUrl: '', findings: [finding], pullRequest: pr, coverage: emptyCoverage('diff'), warnings: [] };
}

test('model prose, evidence and filenames cannot inject HTML, links or GitHub mentions', () => {
  assert.equal(plain('<img src=x>'), '&lt;img src=x&gt;');
  const input = report();
  input.findings = [{ ...finding, explanation: '[click](https://evil.example) @everyone <script>alert(1)</script>', evidence: '</pre><img src=x>' }];
  const output = renderReport(input);
  assert.equal(output.includes('<script>'), false);
  assert.equal(output.includes('<img'), false);
  assert.equal(output.includes('@everyone'), false);
  assert.equal(output.includes('[click](https://evil.example)'), false);
});

test('before-side rename links use the original path at the merge base', () => {
  const input = report();
  input.findings = [{ ...finding, side: 'before' }];
  input.renamedFiles = { 'pipeline.ts': 'old pipeline.ts' };
  assert.match(renderReport(input), /merge-base\/old%20pipeline.ts#L2-L2/);
});

test('redaction handles nested values and multiline secrets without corrupting JSON', () => {
  const input = { text: 'secret\nkey', array: ['test-token'] };
  assert.deepEqual(redact(input, ['secret\nkey', 'test-token']), { text: '[REDACTED]', array: ['[REDACTED]'] });
});

test('large reports remain under the comment length limit', () => {
  const input = report();
  input.findings = Array.from({ length: 15 }, () => ({ ...finding, evidence: '<'.repeat(6000), explanation: 'x'.repeat(2000) }));
  assert.ok(renderReport(input).length <= 60_000);
  assert.match(renderReport(input), /Additional findings/);
});

test('renders concrete recommendations and only canonical research links', () => {
  const input = structuredClone(report());
  input.findings[0]!.references = [{ techniqueId: 'reuse-or-compute', title: 'evil', url: 'javascript:alert(1)' }];
  const markdown = renderReport(input);
  assert.match(markdown, /\*\*Tradeoff:\*\*/);
  assert.match(markdown, /\*\*Verify:\*\*/);
  assert.match(markdown, /https:\/\/developers.openai.com\/api\/docs\/guides\/latency-optimization/);
  assert.equal(markdown.includes('javascript:'), false);
});
