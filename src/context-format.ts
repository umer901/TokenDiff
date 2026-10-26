// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { createHash } from 'node:crypto';
import type { CodeExcerpt, ContextFile, ReviewContext } from './types.js';

/** IDs identify supplied ranges, never model-generated paths or code. */
export function excerptId(file: ContextFile, excerpt: CodeExcerpt): string {
  return createHash('sha256').update(JSON.stringify([
    file.path, excerpt.side, excerpt.startLine, excerpt.lines.length,
  ])).digest('hex').slice(0, 24);
}

/** This exact wire representation is also used for context-budget accounting. */
export function serializeContext(context: ReviewContext): string {
  return JSON.stringify({ files: context.files.map(file => ({
    ...file,
    excerpts: file.excerpts.map(excerpt => ({
      ...excerpt, id: excerptId(file, excerpt), canCite: file.role === 'changed' && excerpt.changedLines.length > 0,
      lines: excerpt.lines.map((text, index) => ({ line: excerpt.startLine + index, text })),
    })),
  })) });
}
