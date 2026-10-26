import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/action.js';
import { config, finding, proposal, repository, runtime } from './helpers.js';

test('end-to-end advisory review writes outputs, summary, report, and one comment', async () => {
  const { api, state } = runtime();
  const comments: string[] = [];
  const report = await runAction(api, {
    github: () => repository({ publishComment: async body => { comments.push(body); return 'published'; } }),
    transport: () => async () => ({ text: JSON.stringify({ findings: [proposal()] }), complete: true }),
  });
  assert.equal(report.status, 'completed');
  assert.equal(state.outputs['findings-count'], 1);
  assert.equal(state.outputs['report-path'], '/tmp/report.json');
  assert.equal(comments.length, 1);
  assert.equal(state.summaries.length, 1);
  assert.deepEqual(state.failures, []);
  assert.ok(state.masks.includes(config.apiKey));
});

test('missing keys skip review and no provider is constructed', async () => {
  const { api, state } = runtime({ 'api-key': '', 'github-token': '' });
  const report = await runAction(api, {
    github: () => { throw new Error('no GitHub token'); },
    transport: () => { throw new Error('must not construct provider'); },
  });
  assert.equal(report.status, 'skipped');
  assert.match(report.reason, /No AI API key/);
  assert.equal(state.failures.length, 0);
  assert.match(state.summaries[0]!, /No successful AI review/);
});

test('fork missing-key skip survives GitHub permissions failures', async () => {
  const { api } = runtime({ 'api-key': '' });
  const report = await runAction(api, { github: () => repository({ getPullRequest: async () => { throw { status: 403 }; } }) });
  assert.equal(report.status, 'skipped');
  assert.match(report.reason, /No AI API key/);
});

test('unsupported events never construct a GitHub client or provider', async () => {
  const { api } = runtime(); api.event.name = 'pull_request_target';
  const report = await runAction(api, { github: () => { throw new Error('must not access'); } });
  assert.equal(report.status, 'skipped');
});

test('invalid configuration fails clearly but still produces a summary and JSON report', async () => {
  const { api, state } = runtime({ provider: 'unknown' });
  const report = await runAction(api, { github: () => repository() });
  assert.equal(report.status, 'error');
  assert.equal(state.failures.length, 1);
  assert.equal(state.reports.length, 1);
  assert.equal(state.summaries.length, 1);
});

test('PR changed during context assembly skips the provider request', async () => {
  const { api } = runtime();
  const report = await runAction(api, {
    github: () => repository({ isCurrent: async () => false, publishComment: async () => 'stale' }),
    transport: () => { throw new Error('must not review stale context'); },
  });
  assert.equal(report.status, 'skipped');
  assert.match(report.warnings[0]!, /no longer current/);
});

test('PR changed during AI review retains the revision-specific report without updating the comment', async () => {
  const { api } = runtime();
  const report = await runAction(api, {
    github: () => repository({ publishComment: async () => 'stale' }),
    transport: () => async () => ({ text: '{"findings":[]}', complete: true }),
  });
  assert.equal(report.status, 'completed');
  assert.match(report.warnings[0]!, /no longer current/);
});

test('comment permission failures retain a successful review in the summary and report', async () => {
  const { api, state } = runtime();
  const report = await runAction(api, {
    github: () => repository({ publishComment: async () => { throw { status: 403 }; } }),
    transport: () => async () => ({ text: '{"findings":[]}', complete: true }),
  });
  assert.equal(report.status, 'completed');
  assert.match(state.summaries[0]!, /Could not update the PR comment/);
  assert.equal(state.reports[0]!.warnings.length, 1);
  assert.equal(state.failures.length, 0);
});

test('provider errors are advisory unavailable results, never clean reviews', async () => {
  const { api, state } = runtime();
  const report = await runAction(api, {
    github: () => repository(),
    transport: () => async () => { throw { status: 401, message: `secret: ${config.apiKey}` }; },
  });
  assert.equal(report.status, 'error');
  assert.equal(state.failures.length, 0);
  assert.match(state.summaries[0]!, /No successful AI review/);
  assert.equal(JSON.stringify(state.reports).includes(config.apiKey), false);
});

test('truncated PR file lists result in partial status even with zero findings', async () => {
  const { api } = runtime();
  const report = await runAction(api, {
    github: () => repository({ listChangedFiles: async () => ({ files: [{ path: 'pipeline.ts', status: 'modified' }], truncated: true }) }),
    transport: () => async () => ({ text: '{"findings":[]}', complete: true }),
  });
  assert.equal(report.status, 'partial');
});

test('all-excluded changes skip without an AI request', async () => {
  const { api } = runtime();
  const report = await runAction(api, {
    github: () => repository({ listChangedFiles: async () => ({ files: [{ path: '.env', status: 'modified' }], truncated: false }) }),
    transport: () => { throw new Error('must not send excluded files'); },
  });
  assert.equal(report.status, 'skipped');
});

test('supplied keys are redacted before source is sent to a provider', async () => {
  const { api } = runtime();
  let sent = '';
  await runAction(api, {
    github: () => repository({ readSource: async (_path, sha) => ({ text: sha === 'merge-base' ? 'old' : `key = "${config.apiKey}"` }) }),
    transport: () => async context => { sent = JSON.stringify(context); return { text: '{"findings":[]}', complete: true }; },
  });
  assert.equal(sent.includes(config.apiKey), false);
  assert.ok(sent.includes('[REDACTED]'));
});

test('provider diagnostic details survive into the JSON report and job summary', async () => {
  const { api, state } = runtime();
  const report = await runAction(api, {
    github: () => repository(),
    transport: () => async () => { throw { status: 404, error: { status: 'NOT_FOUND', message: 'Model retired secret-raw-detail' } }; },
  });
  assert.equal(report.status, 'error');
  assert.equal(report.diagnostics!.attempts.length, 1);
  assert.equal(report.diagnostics!.attempts[0]!.reason, 'model-retired');
  assert.match(state.summaries[0]!, /HTTP 404/);
  assert.equal(JSON.stringify(state.reports).includes('secret-raw-detail'), false);
});
