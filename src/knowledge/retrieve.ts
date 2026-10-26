// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import type { ReviewContext } from '../types.js';
import { serializeContext } from '../context-format.js';
import { KNOWLEDGE_VERSION, TECHNIQUES, type Technique } from './catalog.js';

export const MAX_GUIDANCE_CHARS = 8500;
export const MAX_TECHNIQUES = 5;
export interface RetrievedGuidance { version: string; techniques: Technique[] }
export interface GuidanceCoverage { version: string; techniqueIds: string[]; chars: number }

function tokens(text: string): Set<string> {
  return new Set(text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []);
}

/** Local lexical retrieval: no embeddings service, source uploads or web requests. */
export function retrieveGuidance(context: ReviewContext): RetrievedGuidance {
  const changed = tokens(context.files.filter(f => f.role === 'changed').flatMap(f =>
    f.excerpts.flatMap(e => e.changedLines.map(line => e.lines[line - e.startLine] ?? ''))).join('\n'));
  const nearby = tokens(context.files.flatMap(f => f.excerpts.flatMap(e => e.lines)).join('\n'));
  const ranked = TECHNIQUES.map(technique => ({ technique, score: technique.terms.reduce((sum, term) =>
    sum + (changed.has(term) ? 4 : nearby.has(term) ? 1 : 0), 0) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.technique.id.localeCompare(b.technique.id, 'en'));
  // Conventional reuse is a useful fallback, never evidence of a regression by itself.
  const selected: RetrievedGuidance = { version: KNOWLEDGE_VERSION, techniques: [TECHNIQUES[0]!] };
  for (const { technique } of ranked) {
    if (selected.techniques.some(t => t.id === technique.id)) continue;
    if (selected.techniques.length >= MAX_TECHNIQUES) break;
    selected.techniques.push(technique);
    if (JSON.stringify(selected).length > MAX_GUIDANCE_CHARS) selected.techniques.pop();
  }
  return selected;
}

export function guidanceCoverage(guidance: RetrievedGuidance): GuidanceCoverage {
  return { version: guidance.version, techniqueIds: guidance.techniques.map(t => t.id), chars: JSON.stringify(guidance).length };
}

export function serializeReviewInput(context: ReviewContext, guidance = retrieveGuidance(context)): string {
  return JSON.stringify({ code: JSON.parse(serializeContext(context)), optimizationGuidance: guidance });
}
