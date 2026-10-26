// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_MARKER, GitHubClient, MAX_SOURCE_BYTES } from '../src/github.js';
import { pr } from './helpers.js';

function client(overrides: { comments?: unknown[]; current?: boolean; trees?: Record<string, unknown[]>; blob?: { content: string; encoding: string; size: number }; changedPages?: unknown[][] } = {}) {
  const calls = { creates: [] as unknown[], updates: [] as unknown[], comparisons: [] as unknown[], pages: [] as number[], tree: [] as string[], blobs: [] as string[] };
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({ data: { base: { sha: pr.baseSha }, head: { sha: overrides.current === false ? 'new-head' : pr.headSha }, state: 'open', changed_files: 1, html_url: pr.url } }),
        listFiles: async (args: { page: number }) => { calls.pages.push(args.page); return { data: overrides.changedPages?.[args.page - 1] ?? [] }; },
      },
      repos: { compareCommits: async (args: unknown) => { calls.comparisons.push(args); return { data: { merge_base_commit: { sha: pr.mergeBaseSha } } }; } },
      issues: {
        listComments: async () => {},
        createComment: async (args: unknown) => { calls.creates.push(args); },
        updateComment: async (args: unknown) => { calls.updates.push(args); },
      },
      git: {
        getTree: async (args: { tree_sha: string }) => { calls.tree.push(args.tree_sha); return { data: { tree: overrides.trees?.[args.tree_sha] ?? [], truncated: false } }; },
        getBlob: async (args: { file_sha: string }) => {
          calls.blobs.push(args.file_sha);
          return { data: overrides.blob ?? { content: Buffer.from('hello\n').toString('base64'), encoding: 'base64', size: 6 } };
        },
      },
    },
    paginate: { iterator: async function* () { yield { data: overrides.comments ?? [] }; } },
  } as unknown as ConstructorParameters<typeof GitHubClient>[0];
  return { api: new GitHubClient(octokit, pr.owner, pr.repo, pr.number), calls };
}

test('obtains merge base by immutable SHA comparison rather than using the moving base tip', async () => {
  const { api, calls } = client();
  const pull = await api.getPullRequest();
  assert.equal(pull.mergeBaseSha, pr.mergeBaseSha);
  assert.deepEqual(calls.comparisons[0], { owner: pr.owner, repo: pr.repo, base: pr.baseSha, head: pr.headSha, per_page: 1 });
});

test('paginates changed files and retains the previous filename of renames', async () => {
  const { api, calls } = client({ changedPages: [Array.from({ length: 100 }, (_, n) => ({ filename: `${n}.py`, status: 'modified' })), [{ filename: 'new.go', previous_filename: 'old.go', status: 'renamed' }]] });
  const changes = await api.listChangedFiles();
  assert.deepEqual(calls.pages, [1, 2]);
  assert.equal(changes.truncated, false);
  assert.equal(changes.files[100]!.previousPath, 'old.go');
});

test('marks the GitHub 3000-file API ceiling as truncated', async () => {
  const page = Array.from({ length: 100 }, (_, n) => ({ filename: `${n}.py`, status: 'modified' }));
  const { api } = client({ changedPages: Array.from({ length: 30 }, () => page) });
  const result = await api.listChangedFiles();
  assert.equal(result.truncated, true);
  assert.equal(result.files.length, 3000);
});

test('source reads walk immutable trees and cache repeated blob reads', async () => {
  const { api, calls } = client({ trees: {
    [pr.headSha]: [{ path: 'src', sha: 'src-tree', type: 'tree', mode: '040000' }],
    'src-tree': [{ path: 'agent.py', sha: 'blob1', type: 'blob', mode: '100644', size: 6 }],
  } });
  const first = await api.readSource('src/agent.py', pr.headSha);
  assert.equal(first.text, 'hello\n');
  await api.readSource('src/agent.py', pr.headSha);
  assert.deepEqual(calls.tree, [pr.headSha, 'src-tree']);
  assert.deepEqual(calls.blobs, ['blob1']);
});

test('symlinks and oversized tree entries are never fetched as blobs', async () => {
  const { api, calls } = client({ trees: {
    [pr.headSha]: [
      { path: 'alias.py', sha: 'symlink', type: 'blob', mode: '120000', size: 12 },
      { path: 'huge.py', sha: 'huge', type: 'blob', mode: '100644', size: MAX_SOURCE_BYTES + 1 },
    ],
  } });
  assert.match((await api.readSource('alias.py', pr.headSha)).reason!, /Symlinks/);
  assert.match((await api.readSource('huge.py', pr.headSha)).reason!, /limit/);
  assert.deepEqual(calls.blobs, []);
});

test('invalid UTF-8 and binary contents cannot enter source context', async () => {
  for (const bytes of [Buffer.from([0xff, 0xfe]), Buffer.from([65, 0, 66])]) {
    const { api } = client({
      trees: { [pr.headSha]: [{ path: 'source', sha: 'blob', type: 'blob', mode: '100644', size: bytes.length }] },
      blob: { content: bytes.toString('base64'), encoding: 'base64', size: bytes.length },
    });
    assert.equal((await api.readSource('source', pr.headSha)).text, undefined);
  }
});

test('creates a comment when there is no matching workflow bot comment', async () => {
  const { api, calls } = client({ comments: [
    { id: 1, body: COMMENT_MARKER, user: { login: 'human', type: 'User' } },
    { id: 2, body: COMMENT_MARKER, user: { login: 'other[bot]', type: 'Bot' } },
  ] });
  assert.equal(await api.publishComment(`${COMMENT_MARKER}\nreview`, pr), 'published');
  assert.equal(calls.creates.length, 1);
  assert.equal(calls.updates.length, 0);
});

test('updates the existing TokenDiff comment rather than adding another', async () => {
  const { api, calls } = client({ comments: [{ id: 42, body: `${COMMENT_MARKER}\nold`, user: { login: 'github-actions[bot]', type: 'Bot' } }] });
  await api.publishComment(`${COMMENT_MARKER}\nnew`, pr);
  assert.equal(calls.creates.length, 0);
  assert.equal((calls.updates[0] as { comment_id: number }).comment_id, 42);
});

test('rechecks revisions immediately before publishing and refuses stale writes', async () => {
  const { api, calls } = client({ current: false });
  assert.equal(await api.publishComment(COMMENT_MARKER, pr), 'stale');
  assert.equal(calls.creates.length + calls.updates.length, 0);
});
