export type Provider = 'gemini' | 'openai';
export type ContextMode = 'diff' | 'repository';
export type ReviewStatus = 'completed' | 'partial' | 'skipped' | 'error';
export type Side = 'before' | 'after';

export interface Config {
  provider: Provider;
  model: string;
  apiKey: string;
  githubToken: string;
  contextMode: ContextMode;
  include: string[];
  exclude: string[];
  maxContextChars: number;
  maxOutputTokens: number;
}

export interface PullRequest {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  changedFiles: number;
  url: string;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: string;
}

export interface SourceResult {
  text?: string;
  reason?: string;
}

export interface RepositoryFile {
  path: string;
  size: number;
}

export interface CodeExcerpt {
  side: Side;
  startLine: number;
  lines: string[];
  changedLines: number[];
}

export interface ContextFile {
  path: string;
  previousPath?: string;
  role: 'changed' | 'supporting';
  status: string;
  excerpts: CodeExcerpt[];
}

export interface ReviewContext {
  files: ContextFile[];
}

export interface Coverage {
  mode: ContextMode;
  changedFiles: number;
  reviewedFiles: string[];
  supportingFiles: string[];
  excludedFiles: string[];
  omittedFiles: Array<{ path: string; reason: string }>;
  limitations: string[];
  contextChars: number;
}

export interface Finding {
  category: 'prompt-growth' | 'agent-handoff' | 'redundant-tool-call' | 'model-routing' | 'pipeline-structure';
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
  evidence: string;
  explanation: string;
  impact: string;
  suggestion: string;
  tradeoff: string;
  verification: string;
  techniqueIds: string[];
  references: Array<{ techniqueId: string; title: string; url: string }>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderResult {
  findings: Finding[];
  usage?: Usage;
  diagnostics?: ReviewDiagnostics;
  guidance?: import('./knowledge/retrieve.js').GuidanceCoverage;
}

export interface ReviewAttempt {
  attempt: number;
  elapsedMs: number;
  outcome: 'completed' | 'provider-error' | 'invalid-response' | 'incomplete-response';
  httpStatus?: number;
  reason: string;
  providerCode?: string;
  retryDelayMs?: number;
}

export interface ReviewDiagnostics {
  attempts: ReviewAttempt[];
  elapsedMs: number;
}

export interface Report {
  schemaVersion: 1;
  status: ReviewStatus;
  reason: string;
  provider: string;
  model: string;
  pullRequest?: PullRequest;
  renamedFiles?: Record<string, string>;
  workflowUrl: string;
  findings: Finding[];
  coverage: Coverage;
  usage?: Usage;
  diagnostics?: ReviewDiagnostics;
  guidance?: import('./knowledge/retrieve.js').GuidanceCoverage;
  warnings: string[];
}

export interface SourceRepository {
  readSource(path: string, sha: string): Promise<SourceResult>;
  listRepositoryFiles(sha: string): Promise<{ files: RepositoryFile[]; truncated: boolean }>;
}

export interface GitHubRepository extends SourceRepository {
  getPullRequest(): Promise<PullRequest>;
  listChangedFiles(): Promise<{ files: ChangedFile[]; truncated: boolean }>;
  isCurrent(pr: PullRequest): Promise<boolean>;
  publishComment(body: string, pr: PullRequest): Promise<'published' | 'stale'>;
}
