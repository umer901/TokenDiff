import { z } from 'zod';
import type { Finding, ReviewContext } from './types.js';

export const responseSchema = z.object({
  findings: z.array(z.object({
    category: z.enum(['prompt-growth', 'agent-handoff', 'redundant-tool-call']),
    severity: z.enum(['low', 'medium', 'high']),
    confidence: z.enum(['low', 'medium', 'high']),
    path: z.string(),
    side: z.enum(['before', 'after']),
    startLine: z.int(),
    endLine: z.int(),
    evidence: z.string(),
    explanation: z.string(),
    impact: z.string(),
    suggestion: z.string(),
  }).strict()),
}).strict();

const { $schema: _schema, ...schema } = z.toJSONSchema(responseSchema);
export const responseJsonSchema = schema;

export class InvalidReview extends Error {
  constructor() { super('Provider returned an invalid or unsupported review. No clean review can be inferred.'); }
}

export function validateFindings(raw: unknown, context: ReviewContext): Finding[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.findings.length > 15) throw new InvalidReview();
  const unique = new Map<string, Finding>();
  for (const finding of parsed.data.findings) {
    if (finding.startLine < 1 || finding.endLine < finding.startLine || finding.endLine - finding.startLine > 50) throw new InvalidReview();
    if ([finding.explanation, finding.impact, finding.suggestion].some(s => !s.trim() || s.length > 2000)
      || !finding.evidence.trim() || finding.evidence.length > 6000 || finding.path.length > 1000) throw new InvalidReview();
    const file = context.files.find(file => file.path === finding.path && file.role === 'changed');
    const excerpt = file?.excerpts.find(excerpt => excerpt.side === finding.side
      && finding.startLine >= excerpt.startLine
      && finding.endLine < excerpt.startLine + excerpt.lines.length
      && excerpt.changedLines.some(line => line >= finding.startLine && line <= finding.endLine));
    if (!excerpt) throw new InvalidReview();
    const source = excerpt.lines.slice(finding.startLine - excerpt.startLine, finding.endLine - excerpt.startLine + 1).join('\n');
    if (source.trim() !== finding.evidence.trim()) throw new InvalidReview();
    unique.set(`${finding.category}:${finding.path}:${finding.side}:${finding.startLine}:${finding.endLine}`, finding);
  }
  return [...unique.values()];
}
