// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { structuredPatch } from 'diff';
import { minimatch } from 'minimatch';
import { posix } from 'node:path';
import { MAX_SOURCE_BYTES } from './github.js';
import { serializeContext } from './context-format.js';
import { sameFileDependencies } from './dependencies.js';
import type { ChangedFile, CodeExcerpt, Config, ContextFile, Coverage, PullRequest, RepositoryFile, ReviewContext, SourceRepository, SourceResult } from './types.js';

const BLOCKED_DIRECTORIES = /(^|\/)(?:node_modules|vendor|dist|build|coverage|\.git|\.next|\.venv|venv|__pycache__|target|\.aws|\.ssh|\.kube|secrets?)(\/|$)/i;
const BLOCKED_NAMES = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|(?:.*[-_])?credentials(?:\..*)?|service[-_]account(?:[-_].*)?\.json|kubeconfig(?:\..*)?|secrets?(?:\..*)?|\.npmrc|\.netrc|\.pypirc|.*\.lock|.*-lock\.(?:json|yaml)|npm-shrinkwrap\.json|yarn\.lock|go\.sum|bun\.lockb)$/i;
const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|ico|avif|pdf|zip|gz|tar|7z|woff2?|ttf|eot|mp[34]|mov|wav|ogg|exe|dll|so|dylib|class|pyc|wasm|bin|sqlite3?|db|map)$/i;
const MAX_CHANGED_READS = 100;
const MAX_SUPPORTING_FILES = 20;

export function eligible(path: string, config: Pick<Config, 'include' | 'exclude'>): boolean {
  if (!path || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) return false;
  if (BLOCKED_DIRECTORIES.test(path) || BLOCKED_NAMES.test(posix.basename(path)) || BINARY_EXTENSIONS.test(path)) return false;
  const matches = (pattern: string) => minimatch(path, pattern, { dot: true, nocase: false, nonegate: true });
  return (!config.include.length || config.include.some(matches)) && !config.exclude.some(matches);
}

export function emptyCoverage(mode: Config['contextMode']): Coverage {
  return { mode, changedFiles: 0, reviewedFiles: [], supportingFiles: [], excludedFiles: [], omittedFiles: [], limitations: [], contextChars: 0 };
}

function linesOf(source: string): string[] {
  if (!source) return [];
  const lines = source.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Keep before/after hunks paired, so a regression always has comparison evidence. */
export function excerptsForChange(before: string, after: string, surrounding = 20): CodeExcerpt[][] | undefined {
  const patch = structuredPatch('before', 'after', before, after, undefined, undefined, { context: surrounding, timeout: 1000 });
  if (!patch) return undefined;
  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  return patch.hunks.map(hunk => {
    const oldChanged: number[] = [];
    const newChanged: number[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('-')) oldChanged.push(oldLine++);
      else if (line.startsWith('+')) newChanged.push(newLine++);
      else if (line.startsWith(' ')) { oldLine++; newLine++; }
    }
    const excerpts: CodeExcerpt[] = [];
    if (hunk.oldLines) excerpts.push({
      side: 'before', startLine: hunk.oldStart,
      lines: oldLines.slice(hunk.oldStart - 1, hunk.oldStart - 1 + hunk.oldLines), changedLines: oldChanged,
    });
    if (hunk.newLines) excerpts.push({
      side: 'after', startLine: hunk.newStart,
      lines: newLines.slice(hunk.newStart - 1, hunk.newStart - 1 + hunk.newLines), changedLines: newChanged,
    });
    return excerpts;
  });
}

export function rankRelatedFiles(files: RepositoryFile[], context: ReviewContext, config: Config): RepositoryFile[] {
  const changed = context.files.filter(f => f.role === 'changed');
  const paths = new Set(changed.flatMap(f => [f.path, ...(f.previousPath ? [f.previousPath] : [])]));
  const references = new Set((changed.flatMap(f => f.excerpts.flatMap(e => e.lines))
    .join('\n').match(/[\w./-]+/g) ?? []).flatMap(ref => [ref, ref.replace(/^(?:\.\.?\/)+/, '')]));
  const pathTerms = new Set([...paths].flatMap(path => path.toLowerCase().split(/[^a-z0-9]+/).filter(s => s.length > 2)));
  return files.filter(f => !paths.has(f.path) && eligible(f.path, config) && f.size <= MAX_SOURCE_BYTES)
    .map(file => {
      const noExtension = file.path.replace(/\.[^/.]+$/, '');
      const basename = posix.basename(noExtension);
      const explicit = [file.path, noExtension, noExtension.replaceAll('/', '.'), basename, posix.basename(file.path)]
        .some(ref => ref.length > 2 && (references.has(ref) || references.has(`./${ref}`)));
      const sharedTerms = file.path.toLowerCase().split(/[^a-z0-9]+/).filter(term => pathTerms.has(term)).length;
      const proximity = changed.reduce((best, change) => {
        const a = posix.dirname(file.path).split('/');
        const b = posix.dirname(change.path).split('/');
        let common = 0;
        while (common < a.length && common < b.length && a[common] === b[common]) common++;
        return Math.max(best, common);
      }, 0);
      return { file, explicit: Number(explicit), sharedTerms, proximity };
    })
    .filter(item => item.explicit || item.sharedTerms || item.proximity)
    .sort((a, b) => b.explicit - a.explicit || b.sharedTerms - a.sharedTerms || b.proximity - a.proximity || comparePaths(a.file.path, b.file.path))
    .map(item => item.file);
}

function comparePaths(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export async function buildContext(
  repository: SourceRepository, pr: PullRequest, changes: ChangedFile[], config: Config, truncated = false,
): Promise<{ context: ReviewContext; coverage: Coverage }> {
  const context: ReviewContext = { files: [] };
  const sources = new Map<ContextFile, { before: string; after: string }>();
  const coverage = emptyCoverage(config.contextMode);
  coverage.changedFiles = pr.changedFiles;
  if (truncated || changes.length < pr.changedFiles) coverage.limitations.push('GitHub did not return the complete changed-file list.');
  const candidates = changes.slice().sort((a, b) => comparePaths(a.path, b.path)).filter(file => {
    // A rename must not turn an excluded credential file into model context.
    if (!eligible(file.path, config) || (file.previousPath && !eligible(file.previousPath, config))) {
      coverage.excludedFiles.push(file.path);
      return false;
    }
    return true;
  });
  const fits = () => serializeContext(context).length <= config.maxContextChars;
  for (let index = 0; index < candidates.length; index++) {
    const file = candidates[index]!;
    if (index >= MAX_CHANGED_READS) {
      coverage.omittedFiles.push({ path: file.path, reason: 'The 100 changed-file source-read limit was reached.' });
      continue;
    }
    if (config.maxContextChars - serializeContext(context).length < 200) {
      coverage.omittedFiles.push({ path: file.path, reason: 'Context budget exhausted.' });
      continue;
    }
    const [oldSource, newSource]: [SourceResult, SourceResult] = await Promise.all([
      file.status === 'added' || file.status === 'copied' ? { text: '' } : repository.readSource(file.previousPath ?? file.path, pr.mergeBaseSha),
      file.status === 'removed' ? { text: '' } : repository.readSource(file.path, pr.headSha),
    ]);
    if (oldSource.text === undefined || newSource.text === undefined) {
      coverage.omittedFiles.push({ path: file.path, reason: oldSource.reason ?? newSource.reason ?? 'Comparison source unavailable.' });
      continue;
    }
    const groups = excerptsForChange(oldSource.text, newSource.text);
    if (!groups) {
      coverage.omittedFiles.push({ path: file.path, reason: 'Diff computation exceeded its time limit.' });
      continue;
    }
    if (!groups.length) continue; // Pure renames and metadata changes have no text regression.
    const entry: ContextFile = { ...file, role: 'changed', excerpts: [] };
    context.files.push(entry);
    let omitted = false;
    for (const group of groups) {
      entry.excerpts.push(...group);
      if (!fits()) {
        entry.excerpts.splice(entry.excerpts.length - group.length, group.length);
        // Preserve complete changed ranges but drop optional surrounding lines first.
        const minimal = group.map(excerpt => {
          if (!excerpt.changedLines.length) return excerpt;
          const start = excerpt.changedLines[0]!;
          const end = excerpt.changedLines.at(-1)!;
          return { ...excerpt, startLine: start, lines: excerpt.lines.slice(start - excerpt.startLine, end - excerpt.startLine + 1) };
        });
        entry.excerpts.push(...minimal);
        if (!fits()) {
          entry.excerpts.splice(entry.excerpts.length - minimal.length, minimal.length);
          omitted = true;
        }
      }
    }
    if (!entry.excerpts.length) context.files.pop();
    else {
      coverage.reviewedFiles.push(file.path);
      sources.set(entry, { before: oldSource.text, after: newSource.text });
    }
    if (omitted) coverage.omittedFiles.push({ path: file.path, reason: 'One or more complete hunks did not fit the context budget.' });
  }

  // All changed hunks take priority, followed by same-file helpers, then other files.
  if (config.contextMode === 'repository') {
    let added = 0;
    for (const [file, source] of sources) {
      for (const dependency of sameFileDependencies(file, source.before, source.after)) {
        if (added >= 20) {
          coverage.omittedFiles.push({ path: file.path, reason: 'Same-file helper selection reached its 20-definition limit.' });
          break;
        }
        file.excerpts.push(...dependency.excerpts);
        if (!fits()) {
          file.excerpts.splice(file.excerpts.length - dependency.excerpts.length, dependency.excerpts.length);
          coverage.omittedFiles.push({ path: file.path, reason: `Referenced helper ${dependency.name} did not fit the context budget.` });
        } else {
          added++;
          if (dependency.truncated) coverage.omittedFiles.push({ path: file.path, reason: `Referenced helper ${dependency.name} was limited to 120 lines per definition.` });
        }
      }
    }
  }

  if (config.contextMode === 'repository' && (truncated || changes.length < pr.changedFiles)) {
    coverage.limitations.push('Related-file discovery was skipped because the complete changed-file list is unavailable.');
  } else if (config.contextMode === 'repository' && context.files.length) {
    try {
      const tree = await repository.listRepositoryFiles(pr.headSha);
      if (tree.truncated) coverage.limitations.push('Repository tree was truncated by GitHub; related-file discovery is incomplete.');
      // Only unchanged files may be supporting context. Omitted changed files must not re-enter as unchanged context.
      const allChanged = new Set(changes.flatMap(f => [f.path, ...(f.previousPath ? [f.previousPath] : [])]));
      const ranked = rankRelatedFiles(tree.files.filter(f => !allChanged.has(f.path)), context, config);
      for (const file of ranked.slice(0, MAX_SUPPORTING_FILES)) {
        const source = await repository.readSource(file.path, pr.headSha);
        if (source.text === undefined) {
          coverage.omittedFiles.push({ path: file.path, reason: source.reason ?? 'Related source unavailable.' });
          continue;
        }
        const entry: ContextFile = {
          path: file.path, status: 'unchanged', role: 'supporting',
          excerpts: [{ side: 'after', startLine: 1, lines: linesOf(source.text), changedLines: [] }],
        };
        context.files.push(entry);
        if (!fits()) {
          context.files.pop();
          coverage.omittedFiles.push({ path: file.path, reason: 'Related file did not fit the context budget.' });
        } else coverage.supportingFiles.push(file.path);
      }
      if (ranked.length > MAX_SUPPORTING_FILES) coverage.limitations.push(`${ranked.length - MAX_SUPPORTING_FILES} lower-ranked related files were not selected (20-file limit).`);
    } catch {
      coverage.limitations.push('Repository context could not be retrieved; review uses the available changed code.');
    }
  }
  coverage.contextChars = serializeContext(context).length;
  return { context, coverage };
}
