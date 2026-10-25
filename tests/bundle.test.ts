import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('bundled Action starts in an isolated job and emits a missing-key skip without dependencies or network', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tokendiff-smoke-'));
  const eventPath = join(directory, 'event.json');
  const outputPath = join(directory, 'output.txt');
  const summaryPath = join(directory, 'summary.md');
  await Promise.all([
    writeFile(eventPath, JSON.stringify({ pull_request: { number: 1 } })),
    writeFile(outputPath, ''), writeFile(summaryPath, ''),
  ]);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: 'example/app',
    GITHUB_RUN_ID: '1', GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, RUNNER_TEMP: directory,
    INPUT_PROVIDER: 'gemini', INPUT_MODEL: 'test-model',
  };
  const result = await promisify(execFile)(process.execPath, [resolve('dist/index.cjs')], { cwd: directory, env, timeout: 10_000 });
  assert.equal(result.stderr, '');
  const output = await readFile(outputPath, 'utf8');
  assert.match(output, /skipped/);
  const summary = await readFile(summaryPath, 'utf8');
  assert.match(summary, /No AI API key/);
  const reportPath = output.match(/report-path<<[^\n]+\n([^\n]+)/)?.[1];
  assert.ok(reportPath, 'report-path output should be present');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.status, 'skipped');
  assert.equal(report.findings.length, 0);
});
