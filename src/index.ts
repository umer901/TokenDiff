import * as core from '@actions/core';
import { context } from '@actions/github';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from './action.js';
import { GitHubClient } from './github.js';

const pullNumber = context.payload.pull_request?.number as number | undefined;
const workflowUrl = process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${context.serverUrl}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';

void runAction({
  input: name => core.getInput(name), mask: core.setSecret, warning: core.warning, fail: core.setFailed, output: core.setOutput,
  event: { name: context.eventName, workflowUrl, ...(pullNumber ? { pullNumber } : {}) },
  writeReport: async report => {
    const directory = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'tokendiff-'));
    const path = join(directory, 'report.json');
    await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
    return path;
  },
  writeSummary: async markdown => { await core.summary.addRaw(markdown).write(); },
}, {
  github: config => GitHubClient.create(config.githubToken, context.repo.owner, context.repo.repo, pullNumber!),
}).catch(() => core.setFailed('TokenDiff encountered an unexpected startup or reporting failure.'));
