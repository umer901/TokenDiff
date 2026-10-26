// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

import { ConfigurationError, readConfig, type GetInput } from './config.js';
import { buildContext, emptyCoverage } from './context.js';
import { createTransport, ProviderFailure, review, type ProviderTransport } from './providers.js';
import { redact, renderReport } from './report.js';
import { serializeContext } from './context-format.js';
import type { Config, GitHubRepository, Report } from './types.js';

export interface Runtime {
  input: GetInput;
  mask(secret: string): void;
  warning(message: string): void;
  fail(message: string): void;
  output(name: string, value: string | number): void;
  writeReport(report: Report): Promise<string>;
  writeSummary(markdown: string): Promise<void>;
  event: { name: string; workflowUrl: string; pullNumber?: number };
}

export interface Dependencies {
  github(config: Config): GitHubRepository;
  transport?: (config: Config) => ProviderTransport;
}

export async function runAction(runtime: Runtime, dependencies: Dependencies): Promise<Report> {
  const secrets = [runtime.input('api-key').trim(), runtime.input('github-token').trim()].filter(Boolean);
  for (const secret of secrets) runtime.mask(secret);
  let report: Report = {
    schemaVersion: 1, status: 'error', reason: 'Review could not be started.', provider: 'unconfigured', model: 'unconfigured',
    workflowUrl: runtime.event.workflowUrl, findings: [], coverage: emptyCoverage('diff'), warnings: [],
  };
  let github: GitHubRepository | undefined;
  try {
    const config = readConfig(runtime.input);
    report.provider = config.provider;
    report.model = config.model;
    report.coverage = emptyCoverage(config.contextMode);
    if (runtime.event.name !== 'pull_request' || !runtime.event.pullNumber) {
      report.status = 'skipped';
      report.reason = 'TokenDiff v1 supports pull_request workflows only.';
    } else {
      if (config.githubToken) {
        github = dependencies.github(config);
        try {
          report.pullRequest = await github.getPullRequest();
          report.coverage.changedFiles = report.pullRequest.changedFiles;
        } catch (error) {
          if (config.apiKey) throw error;
          report.warnings.push('PR metadata was unavailable; the missing-key skip is reported in the job summary only.');
        }
      }
      if (!config.apiKey) {
        report.status = 'skipped';
        report.reason = 'No AI API key is available. GitHub normally withholds secrets on fork and Dependabot pull requests.';
      } else if (github && report.pullRequest) {
        const changes = await github.listChangedFiles();
        report.renamedFiles = Object.fromEntries(changes.files.filter(f => f.previousPath).map(f => [f.path, f.previousPath!]));
        const built = await buildContext(github, report.pullRequest, changes.files, config, changes.truncated);
        report.coverage = built.coverage;
        if (!await github.isCurrent(report.pullRequest)) {
          report.status = 'skipped';
          report.reason = 'The pull request changed or closed while collecting context. A newer run should review the current revision.';
        } else if (!built.context.files.length) {
          report.status = 'skipped';
          report.reason = 'No eligible changed code could be included. See the coverage details; no AI review ran.';
        } else {
          const context = redact(built.context, secrets);
          // Re-check after redaction in case a very short supplied secret expanded the payload.
          report.coverage.contextChars = serializeContext(context).length;
          if (report.coverage.contextChars > config.maxContextChars) throw new ProviderFailure('Redacted context exceeds the configured budget. Review unavailable.');
          const result = await review(context, (dependencies.transport ?? createTransport)(config));
          report.findings = result.findings;
          if (result.usage) report.usage = result.usage;
          if (result.diagnostics) report.diagnostics = result.diagnostics;
          if (result.guidance) report.guidance = result.guidance;
          report.status = report.coverage.omittedFiles.length || report.coverage.limitations.length ? 'partial' : 'completed';
          report.reason = report.status === 'partial' ? 'AI review completed with coverage limitations.' : 'AI review completed for the included PR changes.';
        }
      }
    }
  } catch (error) {
    report.status = 'error';
    if (error instanceof ConfigurationError) {
      report.reason = error.message;
      runtime.fail(error.message);
    } else {
      report.reason = error instanceof ProviderFailure ? error.message : 'Required GitHub data or review processing was unavailable. Check permissions and retry the workflow.';
      if (error instanceof ProviderFailure && error.usage) report.usage = error.usage;
      if (error instanceof ProviderFailure && error.diagnostics) report.diagnostics = error.diagnostics;
      if (error instanceof ProviderFailure && error.guidance) report.guidance = error.guidance;
      runtime.warning(report.reason);
    }
  }
  report = redact(report, secrets);
  if (github && report.pullRequest) {
    try {
      if (await github.publishComment(renderReport(report), report.pullRequest) === 'stale') {
        report.warnings.push('PR comment was not updated because the reviewed revision is no longer current.');
      }
    } catch {
      const message = 'Could not update the PR comment. Results remain in the job summary and JSON report; check pull-requests: write permission.';
      report.warnings.push(message);
      runtime.warning(message);
    }
  }
  let reportPath = '';
  try { reportPath = await runtime.writeReport(report); }
  catch {
    report.warnings.push('The JSON report could not be written to the runner temporary directory.');
    runtime.warning('Could not write the JSON report. Results remain in the job summary.');
  }
  runtime.output('status', report.status);
  runtime.output('findings-count', report.findings.length);
  runtime.output('report-path', reportPath);
  try { await runtime.writeSummary(renderReport(report)); }
  catch { runtime.warning('Could not write the Actions job summary. Check the report-path output and PR comment.'); }
  return report;
}
