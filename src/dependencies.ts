// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import type { CodeExcerpt, ContextFile } from './types.js';

interface Definition { name: string; start: number; end: number }

function definitions(lines: string[]): Definition[] {
  const found: Definition[] = [];
  for (const [index, line] of lines.entries()) {
    const python = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
    const other = /^\s*(?:(?:export|default|pub|async|static)\s+)*(?:function\s+|fn\s+|func\s+(?:\([^)]*\)\s*)?)(\w+)\s*[<(]/.exec(line)
      ?? /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=.*=>/.exec(line);
    const name = python?.[1] ?? other?.[1];
    if (!name) continue;
    const indent = line.length - line.trimStart().length;
    let end = index + 1;
    if (python) {
      while (end < lines.length) {
        const next = lines[end]!;
        if (next.trim() && !next.trimStart().startsWith('#') && next.length - next.trimStart().length <= indent) break;
        end++;
      }
    } else if (!/\{.*\}/.test(line) && !/=>[^{}]*;?\s*$/.test(line)) {
      // Conservative lexical window for brace languages; no source is executed.
      while (end < lines.length) {
        const next = lines[end++]!;
        if (/^\s*}/.test(next) && next.length - next.trimStart().length <= indent) break;
      }
    }
    while (end > index + 1 && !lines[end - 1]!.trim()) end--;
    found.push({ name, start: index + 1, end });
  }
  return found;
}

/** One hop of textual call references. This is deliberately not a call graph. */
export function sameFileDependencies(file: ContextFile, before: string, after: string): Array<{ name: string; excerpts: CodeExcerpt[]; truncated: boolean }> {
  const refs = new Set(file.excerpts.flatMap(e => e.lines).flatMap(line =>
    [...line.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(match => match[1]!)));
  const versions = [
    { side: 'before' as const, lines: before.split('\n') },
    { side: 'after' as const, lines: after.split('\n') },
  ].map(version => ({ ...version, definitions: definitions(version.lines) }));
  const names = [...new Set(versions.flatMap(v => v.definitions.map(d => d.name)))].filter(n => refs.has(n)).sort();
  return names.flatMap(name => {
    const excerpts: CodeExcerpt[] = [];
    let truncated = false;
    for (const version of versions) {
      for (const definition of version.definitions.filter(d => d.name === name)) {
        if (file.excerpts.some(e => e.side === version.side && e.startLine <= definition.start
          && e.startLine + e.lines.length > definition.end)) continue;
        const end = Math.min(definition.end, definition.start + 119);
        truncated ||= end < definition.end;
        excerpts.push({ side: version.side, startLine: definition.start,
          lines: version.lines.slice(definition.start - 1, end), changedLines: [] });
      }
    }
    return excerpts.length ? [{ name, excerpts, truncated }] : [];
  });
}
