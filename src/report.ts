import { COMMENT_MARKER } from './github.js';
import type { Finding, Report } from './types.js';
import { TECHNIQUES } from './knowledge/catalog.js';

/** Provider text is rendered as text, never as executable HTML, links, or mentions. */
export function plain(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+!|~])/g, '\\$1').replace(/@/g, '@\u200b')
    .replace(/https?:\/\//gi, match => match.replace(':', ':\u200b'));
}

function code(value: string): string {
  return `<pre>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '@\u200b')}</pre>`;
}

function sourceUrl(finding: Finding, report: Report): string | undefined {
  const pr = report.pullRequest;
  if (!pr) return undefined;
  const origin = new URL(pr.url).origin;
  const path = finding.side === 'before'
    ? reportPathBefore(finding.path, report) : finding.path;
  const revision = finding.side === 'before' ? pr.mergeBaseSha : pr.headSha;
  return `${origin}/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/blob/${encodeURIComponent(revision)}/${path.split('/').map(encodeURIComponent).join('/')}#L${finding.startLine}-L${finding.endLine}`;
}

// Renamed paths are retained in the report for correct before-side permalinks.
function reportPathBefore(path: string, report: Report): string {
  return report.renamedFiles?.[path] ?? path;
}

export function renderReport(report: Report): string {
  const lines = [COMMENT_MARKER, '## TokenDiff — AI pipeline efficiency review', '', `**Status: ${report.status}.** ${plain(report.reason)}`, '',
    `Provider: **${plain(report.provider)}** · Model: **${plain(report.model)}**`,
    ''];
  if (report.pullRequest) lines.push(`Reviewed commit: \`${report.pullRequest.headSha}\``, '');
  if (report.workflowUrl) lines.push(`[Workflow run](${report.workflowUrl})`, '');
  if (report.status === 'skipped' || report.status === 'error') lines.push('**No successful AI review is available for this run.**', '');
  else if (!report.findings.length) lines.push('No supported efficiency regressions were found in the reviewed context. This is not a runtime efficiency measurement.', '');

  for (const [index, finding] of report.findings.entries()) {
    const url = sourceUrl(finding, report);
    const location = `${plain(finding.path)}:${finding.startLine}–${finding.endLine} (${finding.side})`;
    const block = [
      `### ${index + 1}. ${finding.category} — ${finding.severity} severity`, '',
      `Confidence: **${finding.confidence}** · ${url ? `[${location}](${url})` : location}`, '',
      plain(finding.explanation), '', code(finding.evidence), '',
      `**Likely impact:** ${plain(finding.impact)}`, '', `**Suggestion:** ${plain(finding.suggestion)}`, '',
      `**Tradeoff:** ${plain(finding.tradeoff)}`, '', `**Verify:** ${plain(finding.verification)}`, '',
      `**Guidance:** ${finding.techniqueIds.flatMap(id => {
        const technique = TECHNIQUES.find(t => t.id === id);
        return technique ? [`[${plain(technique.source.title)}](${technique.source.url})`] : [];
      }).join(' · ')}`, '',
    ].join('\n');
    if (lines.join('\n').length + block.length > 48_000) {
      lines.push('Additional findings are available in the JSON report (comment size limit).', '');
      break;
    }
    lines.push(block);
  }
  const c = report.coverage;
  lines.push('### Coverage', '', `Mode: **${c.mode}** · ${c.reviewedFiles.length}/${c.changedFiles} changed files reviewed · ${c.supportingFiles.length} supporting files · ${c.contextChars} context characters`, '');
  if (c.excludedFiles.length) lines.push(`${c.excludedFiles.length} changed files excluded by file rules.`, '');
  if (c.reviewedFiles.length) lines.push(`Reviewed: ${c.reviewedFiles.slice(0, 15).map(plain).join(', ')}${c.reviewedFiles.length > 15 ? ', … (full list in JSON report)' : ''}`, '');
  if (c.supportingFiles.length) lines.push(`Supporting: ${c.supportingFiles.slice(0, 15).map(plain).join(', ')}${c.supportingFiles.length > 15 ? ', … (full list in JSON report)' : ''}`, '');
  if (c.omittedFiles.length) {
    lines.push(`**${c.omittedFiles.length} files have omitted content:**`, '');
    for (const omitted of c.omittedFiles.slice(0, 10)) lines.push(`- ${plain(omitted.path.slice(0, 200))}: ${plain(omitted.reason)}`);
    if (c.omittedFiles.length > 10) lines.push('- Full omission list is available in the JSON report.');
    lines.push('');
  }
  for (const limitation of [...c.limitations, ...report.warnings]) lines.push(`- ${plain(limitation)}`);
  if (report.guidance) lines.push('', `Optimization guidance: ${plain(report.guidance.version)} · ${report.guidance.techniqueIds.length} techniques retrieved · ${report.guidance.chars} additional context characters.`, '');
  if (report.usage) {
    lines.push('', `Review API usage (not application usage): input ${report.usage.inputTokens ?? 'unreported'}, output ${report.usage.outputTokens ?? 'unreported'}, total ${report.usage.totalTokens ?? 'unreported'} tokens.`);
  }
  if (report.diagnostics) {
    lines.push('', `Review attempts: ${report.diagnostics.attempts.length} · elapsed ${report.diagnostics.elapsedMs} ms.`, '');
    for (const attempt of report.diagnostics.attempts) {
      lines.push(`- Attempt ${attempt.attempt}: ${plain(attempt.reason)}${attempt.httpStatus ? ` (HTTP ${attempt.httpStatus})` : ''}${attempt.providerCode ? `, ${plain(attempt.providerCode)}` : ''}; ${attempt.elapsedMs} ms${attempt.retryDelayMs === undefined ? '' : `; retry wait ${attempt.retryDelayMs} ms`}.`);
    }
  }
  lines.push('', '_Advisory only. Findings describe inferred regressions, not measured runtime costs._');
  const result = lines.join('\n');
  return result.length > 60_000 ? `${result.slice(0, 59_800)}\n\nReport shortened; consult the JSON report for full coverage details.` : result;
}

export function redact<T>(value: T, secrets: string[]): T {
  // Recursion keeps JSON escaping and object shape intact, including multiline values.
  if (typeof value === 'string') {
    return secrets.filter(Boolean).sort((a, b) => b.length - a.length)
      .reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value) as T;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)])) as T;
  }
  return value;
}
