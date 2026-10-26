// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { getOctokit } from '@actions/github';
import type { ChangedFile, GitHubRepository, PullRequest, SourceResult } from './types.js';

export const COMMENT_MARKER = '<!-- tokendiff:review:v1 -->';
export const MAX_SOURCE_BYTES = 256 * 1024;
type Octokit = ReturnType<typeof getOctokit>;

export class GitHubFailure extends Error {
  constructor(public readonly status: number | undefined) {
    super(status === 401 || status === 403
      ? 'GitHub access was denied. Check workflow token permissions.'
      : status === 429 ? 'GitHub API rate limit reached.' : 'A required GitHub API request failed.');
  }
}

export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : 'code' in error ? error.code : undefined;
  return typeof value === 'number' && value >= 100 && value <= 599 ? value : undefined;
}

export class GitHubClient implements GitHubRepository {
  private readonly cache = new Map<string, Promise<SourceResult>>();
  private readonly trees = new Map<string, Promise<Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number }>>>();

  constructor(
    private readonly octokit: Octokit,
    private readonly owner: string,
    private readonly repo: string,
    private readonly number: number,
  ) {}

  static create(token: string, owner: string, repo: string, number: number): GitHubClient {
    return new GitHubClient(getOctokit(token, { request: { timeout: 20_000 } }), owner, repo, number);
  }

  private get coordinates() { return { owner: this.owner, repo: this.repo }; }
  private async guarded<T>(request: () => Promise<T>): Promise<T> {
    try { return await request(); } catch (error) { throw new GitHubFailure(errorStatus(error)); }
  }

  async getPullRequest(): Promise<PullRequest> {
    return this.guarded(async () => {
      const { data: pr } = await this.octokit.rest.pulls.get({ ...this.coordinates, pull_number: this.number });
      const { data: comparison } = await this.octokit.rest.repos.compareCommits({
        ...this.coordinates, base: pr.base.sha, head: pr.head.sha, per_page: 1,
      });
      return {
        ...this.coordinates, number: this.number, baseSha: pr.base.sha, headSha: pr.head.sha,
        mergeBaseSha: comparison.merge_base_commit.sha, changedFiles: pr.changed_files, url: pr.html_url,
      };
    });
  }

  async listChangedFiles(): Promise<{ files: ChangedFile[]; truncated: boolean }> {
    return this.guarded(async () => {
      const files: ChangedFile[] = [];
      for (let page = 1; page <= 30; page++) {
        const { data } = await this.octokit.rest.pulls.listFiles({
          ...this.coordinates, pull_number: this.number, per_page: 100, page,
        });
        for (const file of data) files.push({
          path: file.filename, status: file.status,
          ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
        });
        if (data.length < 100) return { files, truncated: false };
      }
      return { files, truncated: true };
    });
  }

  async isCurrent(pr: PullRequest): Promise<boolean> {
    return this.guarded(async () => {
      const { data } = await this.octokit.rest.pulls.get({ ...this.coordinates, pull_number: this.number });
      return data.state === 'open' && data.head.sha === pr.headSha && data.base.sha === pr.baseSha;
    });
  }

  readSource(path: string, sha: string): Promise<SourceResult> {
    const key = `${sha}:${path}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.fetchSource(path, sha);
    this.cache.set(key, result);
    return result;
  }

  private async fetchSource(path: string, sha: string): Promise<SourceResult> {
    try {
      // Walk immutable trees instead of the Contents API, which can dereference symlinks.
      const parts = path.split('/');
      let treeSha = sha;
      let blobSha: string | undefined;
      for (let index = 0; index < parts.length; index++) {
        let pending = this.trees.get(treeSha);
        if (!pending) {
          pending = this.octokit.rest.git.getTree({ ...this.coordinates, tree_sha: treeSha }).then(result => {
            if (result.data.truncated) throw new Error('Incomplete tree');
            return result.data.tree;
          });
          this.trees.set(treeSha, pending);
        }
        const entry = (await pending).find(entry => entry.path === parts[index]);
        if (!entry?.sha) return { reason: 'File is unavailable at the reviewed revision.' };
        if (index < parts.length - 1) {
          if (entry.type !== 'tree') return { reason: 'Symlink or non-directory path excluded.' };
          treeSha = entry.sha;
        } else {
          if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode ?? '')) {
            return { reason: 'Symlinks and submodules are excluded.' };
          }
          if ((entry.size ?? 0) > MAX_SOURCE_BYTES) return { reason: 'File exceeds the 256 KiB per-file read limit.' };
          blobSha = entry.sha;
        }
      }
      if (!blobSha) return { reason: 'Source file unavailable.' };
      const { data } = await this.octokit.rest.git.getBlob({ ...this.coordinates, file_sha: blobSha });
      if ((data.size ?? 0) > MAX_SOURCE_BYTES || data.encoding !== 'base64') {
        return { reason: 'File exceeds the 256 KiB per-file read limit or has no readable content.' };
      }
      const bytes = Buffer.from(data.content, 'base64');
      if (bytes.length > MAX_SOURCE_BYTES) return { reason: 'File exceeds the 256 KiB per-file read limit.' };
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n');
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return { reason: 'Binary or non-text content excluded.' };
      return { text };
    } catch (error) {
      if (error instanceof TypeError) return { reason: 'File is not valid UTF-8 text.' };
      return { reason: errorStatus(error) === 404 ? 'File is unavailable at the reviewed revision.' : 'Source could not be read from GitHub.' };
    }
  }

  async listRepositoryFiles(sha: string) {
    return this.guarded(async () => {
      const { data } = await this.octokit.rest.git.getTree({ ...this.coordinates, tree_sha: sha, recursive: 'true' });
      return {
        files: data.tree.filter(entry => entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755') && entry.path)
          .map(entry => ({ path: entry.path!, size: entry.size ?? MAX_SOURCE_BYTES + 1 })),
        truncated: data.truncated,
      };
    });
  }

  async publishComment(body: string, pr: PullRequest): Promise<'published' | 'stale'> {
    return this.guarded(async () => {
      // Match both the marker and the workflow bot, never user-authored lookalikes.
      let commentId: number | undefined;
      for await (const page of this.octokit.paginate.iterator(this.octokit.rest.issues.listComments, {
        ...this.coordinates, issue_number: this.number, per_page: 100,
      })) {
        for (const comment of page.data) {
          if (comment.body?.startsWith(COMMENT_MARKER) && comment.user?.type === 'Bot'
            && /^github-actions(?:\[bot\])?$/.test(comment.user.login)) {
            commentId = comment.id;
            break;
          }
        }
        if (commentId) break;
      }
      if (!await this.isCurrent(pr)) return 'stale';
      if (commentId) {
        await this.octokit.rest.issues.updateComment({ ...this.coordinates, comment_id: commentId, body });
      } else {
        await this.octokit.rest.issues.createComment({ ...this.coordinates, issue_number: this.number, body });
      }
      return 'published';
    });
  }
}
