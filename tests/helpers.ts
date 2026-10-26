// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import type { Config, GitHubRepository, PullRequest, Report, ReviewContext } from '../src/types.js';
import type { Runtime } from '../src/action.js';
import { TECHNIQUES } from '../src/knowledge/catalog.js';
import { excerptId } from '../src/context-format.js';

export const config: Config = {
  provider: 'gemini', model: 'test-model', apiKey: 'test-api-key-secret', githubToken: 'test-github-secret',
  contextMode: 'diff', include: [], exclude: [], maxContextChars: 60_000, maxOutputTokens: 4096,
};
export const pr: PullRequest = {
  owner: 'example', repo: 'app', number: 7, baseSha: 'base-sha', headSha: 'head-sha', mergeBaseSha: 'merge-base',
  changedFiles: 1, url: 'https://github.com/example/app/pull/7',
};
export const context: ReviewContext = { files: [{
  path: 'pipeline.ts', role: 'changed', status: 'modified', excerpts: [
    { side: 'before', startLine: 1, lines: ['const data = await fetchData(id);'], changedLines: [] },
    { side: 'after', startLine: 1, lines: ['const data = await fetchData(id);', 'const duplicate = await fetchData(id);'], changedLines: [2] },
  ],
}] };
export const finding = {
  category: 'redundant-tool-call' as const, severity: 'medium' as const, confidence: 'high' as const,
  path: 'pipeline.ts', side: 'after' as const, startLine: 2, endLine: 2,
  evidence: 'const duplicate = await fetchData(id);', explanation: 'The same data is fetched again with identical arguments.',
  impact: 'The added call may repeat tool work and context.', suggestion: 'Reuse the existing data result.',
  tradeoff: 'Reuse is safe only for equivalent reads with matching freshness and authorization.',
  verification: 'Compare results and call traces for repeated IDs and permission boundaries.',
  techniqueIds: ['reuse-or-compute'],
  references: [{ techniqueId: 'reuse-or-compute', title: TECHNIQUES[0]!.source.title, url: TECHNIQUES[0]!.source.url }],
};

export function proposal(value = finding, input = context) {
  const file = input.files.find(f => f.path === value.path)!;
  const excerpt = file.excerpts.find(e => e.side === value.side && value.startLine >= e.startLine
    && value.endLine < e.startLine + e.lines.length)!;
  const { path: _path, side: _side, evidence: _evidence, references: _references, ...rest } = value;
  return { ...rest, excerptId: excerptId(file, excerpt) };
}

export function repository(overrides: Partial<GitHubRepository> = {}): GitHubRepository {
  return {
    getPullRequest: async () => ({ ...pr }),
    listChangedFiles: async () => ({ files: [{ path: 'pipeline.ts', status: 'modified' }], truncated: false }),
    readSource: async (_path, sha) => ({ text: sha === pr.mergeBaseSha
      ? 'const data = await fetchData(id);\n'
      : 'const data = await fetchData(id);\nconst duplicate = await fetchData(id);\n' }),
    listRepositoryFiles: async () => ({ files: [], truncated: false }),
    isCurrent: async () => true,
    publishComment: async () => 'published',
    ...overrides,
  };
}

export function runtime(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    provider: config.provider, model: config.model, 'api-key': config.apiKey, 'github-token': config.githubToken,
    ...overrides,
  };
  const state = { warnings: [] as string[], failures: [] as string[], masks: [] as string[], summaries: [] as string[], outputs: {} as Record<string, string | number>, reports: [] as Report[] };
  const api: Runtime = {
    input: key => values[key] ?? '',
    mask: value => { state.masks.push(value); },
    warning: value => { state.warnings.push(value); },
    fail: value => { state.failures.push(value); },
    output: (key, value) => { state.outputs[key] = value; },
    writeReport: async report => { state.reports.push(report); return '/tmp/report.json'; },
    writeSummary: async value => { state.summaries.push(value); },
    event: { name: 'pull_request', workflowUrl: 'https://github.com/example/app/actions/runs/1', pullNumber: 7 },
  };
  return { api, state };
}
