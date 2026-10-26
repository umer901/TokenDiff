// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { z } from 'zod';
import type { Finding, ReviewContext } from './types.js';
import { excerptId } from './context-format.js';
import { retrieveGuidance, type RetrievedGuidance } from './knowledge/retrieve.js';

export const responseSchema = z.object({
  findings: z.array(z.object({
    category: z.enum(['prompt-growth', 'agent-handoff', 'redundant-tool-call', 'model-routing', 'pipeline-structure']),
    severity: z.enum(['low', 'medium', 'high']),
    confidence: z.enum(['low', 'medium', 'high']),
    excerptId: z.string(),
    startLine: z.int(),
    endLine: z.int(),
    explanation: z.string(),
    impact: z.string(),
    suggestion: z.string(),
    tradeoff: z.string(),
    verification: z.string(),
    techniqueIds: z.array(z.string()),
  }).strict()),
}).strict();

const { $schema: _schema, ...schema } = z.toJSONSchema(responseSchema);
export const responseJsonSchema = schema;

export class InvalidReview extends Error {
  constructor(public readonly reason = 'invalid-schema') {
    super(`Provider returned an invalid or unsupported review (${reason}). No clean review can be inferred.`);
  }
}

export function validateFindings(raw: unknown, context: ReviewContext, guidance: RetrievedGuidance = retrieveGuidance(context)): Finding[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.findings.length > 15) throw new InvalidReview();
  const unique = new Map<string, Finding>();
  for (const finding of parsed.data.findings) {
    if (finding.startLine < 1 || finding.endLine < finding.startLine || finding.endLine - finding.startLine > 50) throw new InvalidReview('invalid-range');
    if ([finding.explanation, finding.impact, finding.suggestion, finding.tradeoff, finding.verification].some(s => !s.trim() || s.length > 2000)
      || finding.excerptId.length > 100) throw new InvalidReview('invalid-content');
    if (!finding.techniqueIds.length || finding.techniqueIds.length > 3
      || new Set(finding.techniqueIds).size !== finding.techniqueIds.length) throw new InvalidReview('invalid-technique-ids');
    const references = finding.techniqueIds.map(id => {
      const technique = guidance.techniques.find(t => t.id === id);
      if (!technique) throw new InvalidReview('technique-not-retrieved');
      return { techniqueId: id, title: technique.source.title, url: technique.source.url };
    });
    const file = context.files.find(file => file.role === 'changed'
      && file.excerpts.some(excerpt => excerptId(file, excerpt) === finding.excerptId));
    const excerpt = file?.excerpts.find(excerpt => excerptId(file, excerpt) === finding.excerptId);
    if (!file || !excerpt) throw new InvalidReview('unknown-excerpt');
    if (finding.startLine < excerpt.startLine || finding.endLine >= excerpt.startLine + excerpt.lines.length) throw new InvalidReview('range-outside-excerpt');
    if (!excerpt.changedLines.some(line => line >= finding.startLine && line <= finding.endLine)) throw new InvalidReview('range-without-changes');
    const source = excerpt.lines.slice(finding.startLine - excerpt.startLine, finding.endLine - excerpt.startLine + 1).join('\n');
    if (!source.trim() || source.length > 6000) throw new InvalidReview('invalid-evidence-size');
    const { excerptId: _id, ...details } = finding;
    const validated: Finding = { ...details, path: file.path, side: excerpt.side, evidence: source, references };
    unique.set(`${finding.category}:${file.path}:${excerpt.side}:${finding.startLine}:${finding.endLine}`, validated);
  }
  return [...unique.values()];
}
