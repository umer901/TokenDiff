// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 TokenDiff contributors

/** Maintainer-written summaries, not copied passages. See docs/optimization-knowledge.md. */
export interface Technique {
  id: string;
  title: string;
  source: { title: string; url: string; kind: 'paper' | 'engineering-blog' | 'documentation' };
  terms: string[];
  principle: string;
  application: string;
  cautions: string;
  verify: string;
}

export const KNOWLEDGE_VERSION = '2026-10-26.1';
export const TECHNIQUES: readonly Technique[] = [
  {
    id: 'reuse-or-compute', title: 'Reuse equivalent work or compute it deterministically',
    source: { title: 'OpenAI: Latency optimization', url: 'https://developers.openai.com/api/docs/guides/latency-optimization', kind: 'documentation' },
    terms: ['duplicate', 'repeat', 'fetch', 'lookup', 'call', 'tool', 'format', 'json', 'parse', 'cache'],
    principle: 'Avoid unnecessary model requests; conventional computation and caching can replace some model work.',
    application: 'For newly repeated equivalent reads, reuse the existing result within the request. For fixed formatting or parsing, prefer deterministic code when the contract is known. Name the specific variable or call to change.',
    cautions: 'Identical arguments do not prove purity. Preserve side effects, freshness, authorization boundaries and intentional repeated sampling; parallelization alone does not reduce tokens.',
    verify: 'Compare outputs, side effects, freshness and call traces on representative inputs before measuring request usage and latency.',
  },
  {
    id: 'task-model-routing', title: 'Route easy tasks to a smaller model',
    source: { title: 'RouteLLM: Learning to Route LLMs with Preference Data', url: 'https://arxiv.org/abs/2406.18665v4', kind: 'paper' },
    terms: ['model', 'route', 'router', 'classify', 'classification', 'extract', 'label', 'small', 'large', 'strong', 'cheap', 'premium', 'difficulty'],
    principle: 'Learned routing selects between stronger and weaker models using quality preferences rather than treating all queries alike.',
    application: 'Isolate a bounded classification, extraction or formatting stage and evaluate a smaller model there; keep a stronger path for difficult or consequential cases. Specify the stage and routing criterion from visible code.',
    cautions: 'Low frequency is not low complexity or low consequence. Do not infer price or capability from a model name, or downgrade safety-critical decisions without evidence. Routing has overhead and can misroute.',
    verify: 'Evaluate representative and difficult inputs, routing errors, task-quality acceptance criteria, latency and provider-reported usage before enabling the route.',
  },
  {
    id: 'quality-gated-cascade', title: 'Escalate only when a cheaper stage fails a quality gate',
    source: { title: 'FrugalGPT', url: 'https://arxiv.org/abs/2305.05176v1', kind: 'paper' },
    terms: ['fallback', 'confidence', 'threshold', 'validate', 'validation', 'retry', 'model', 'escalate', 'cascade'],
    principle: 'Model cascades conditionally escalate requests, balancing answer quality with inference expenditure.',
    application: 'Where the PR adds unconditional expensive processing, propose a smaller first stage with a task-specific acceptance gate and an explicit stronger fallback. Prefer measurable schema or correctness checks over self-reported model confidence.',
    cautions: 'A cascade can cost more when most inputs escalate. Do not remove necessary checks or cite paper savings as application savings.',
    verify: 'Measure quality, escalation rate and total usage including both stages on held-out and failure cases.',
  },
  {
    id: 'bounded-pipeline-stages', title: 'Split mixed-complexity work with compact stage contracts',
    source: { title: 'Anthropic: Building effective agents', url: 'https://www.anthropic.com/research/building-effective-agents', kind: 'engineering-blog' },
    terms: ['pipeline', 'agent', 'handoff', 'delegate', 'stage', 'workflow', 'classify', 'extract', 'reason', 'history', 'messages', 'chain'],
    principle: 'Fixed subtasks can be chained or routed; simpler workflows should be preferred when sufficient.',
    application: 'When new stages mix simple extraction with expensive reasoning or forward unnecessary history, name useful boundaries such as deterministic preparation, bounded extraction, then reasoning. Pass a typed compact result and relevant source references rather than the entire transcript.',
    cautions: 'Splitting adds calls, orchestration and possible error propagation. Recommend it only when visible context isolation, conditional execution or task-specific model choice plausibly offsets this overhead; a smaller chunk alone is not an efficiency gain.',
    verify: 'Compare the complete pipeline against the unsplit baseline for answer quality, stage failures, total usage and latency.',
  },
  {
    id: 'prompt-compression', title: 'Compress redundant prompt material selectively',
    source: { title: 'LLMLingua', url: 'https://arxiv.org/abs/2310.05736v2', kind: 'paper' },
    terms: ['prompt', 'system', 'instructions', 'compress', 'compression', 'repeat', 'duplicate', 'examples', 'few', 'shot', 'context'],
    principle: 'Budgeted prompt compression can retain useful information while reducing redundant prompt content.',
    application: 'First remove literal duplicates and irrelevant examples at the changed construction site. Consider a tested compression stage only for substantial recurring context; preserve exact identifiers, units, constraints and source references.',
    cautions: 'Compression is lossy and adds processing. Do not delete safety rules, required evidence or task-critical details, or assume published compression ratios transfer to this application.',
    verify: 'Evaluate factual fidelity, exact-value preservation, downstream answer quality and total compression-plus-generation overhead.',
  },
  {
    id: 'query-aware-retrieval', title: 'Select query-relevant evidence before assembling a prompt',
    source: { title: 'LongLLMLingua', url: 'https://arxiv.org/abs/2310.06839v2', kind: 'paper' },
    terms: ['retrieve', 'retrieval', 'rag', 'documents', 'chunks', 'search', 'query', 'rank', 'top', 'context'],
    principle: 'Query-aware compression and context organization help concentrate relevant information in long-context tasks.',
    application: 'For newly enlarged retrieved context, deduplicate overlapping chunks and select or compress evidence relevant to the current query before concatenation. Retain provenance and a path to fetch omitted material.',
    cautions: 'This is a possible application of the research, not proof that a particular top-k is sufficient. Aggressive filtering can lose multi-hop evidence or minority facts.',
    verify: 'Measure retrieval recall, citation correctness and answer quality on multi-document and long-tail questions alongside prompt usage.',
  },
  {
    id: 'compact-agent-state', title: 'Carry compact state instead of replaying full histories',
    source: { title: 'Anthropic: Effective context engineering for AI agents', url: 'https://www.anthropic.com/research/effective-context-engineering-for-ai-agents', kind: 'engineering-blog' },
    terms: ['history', 'messages', 'transcript', 'conversation', 'state', 'memory', 'agent', 'handoff', 'summary', 'summarize'],
    principle: 'Compaction and structured notes can preserve useful state without carrying every old tool result into every step.',
    application: 'At the new handoff or loop, pass decisions, unresolved questions, identifiers and relevant evidence references; keep full results in the audit store and retrieve them when needed.',
    cautions: 'Summaries can erase subtle facts. Preserve auditability and required evidence; compaction itself may add model work and should not run unnecessarily.',
    verify: 'Replay long conversations and recovery cases to check continuity, evidence fidelity and cumulative usage.',
  },
  {
    id: 'bounded-tool-results', title: 'Filter and paginate model-facing tool results',
    source: { title: 'Anthropic: Writing effective tools for agents', url: 'https://www.anthropic.com/research/writing-tools-for-agents', kind: 'engineering-blog' },
    terms: ['tool', 'mcp', 'result', 'results', 'output', 'serialize', 'json', 'records', 'rows', 'pagination', 'filter'],
    principle: 'Tool responses should return useful context in bounded amounts, using selection and pagination where appropriate.',
    application: 'At the changed serializer, include fields and rows needed for the current decision, preserve Unicode and identifiers, and expose truncation plus a continuation mechanism. Keep full records outside model context when an audit requires them.',
    cautions: 'Do not silently truncate required evidence or alter the tool contract. Compact JSON characters are not a measured token saving.',
    verify: 'Check selection completeness, continuation behavior, audit preservation and decision accuracy; measure provider token usage separately.',
  },
  {
    id: 'stable-prompt-prefix', title: 'Keep reusable prompt prefixes stable',
    source: { title: 'OpenAI: Prompt caching', url: 'https://developers.openai.com/api/docs/guides/prompt-caching', kind: 'documentation' },
    terms: ['cache', 'prefix', 'timestamp', 'uuid', 'system', 'instructions', 'static', 'dynamic', 'prompt'],
    principle: 'Prompt caching can reuse matching prompt prefixes when the selected provider and model support it.',
    application: 'If newly inserted request-specific text breaks an otherwise reusable prefix, keep stable instructions and examples before dynamic content where semantics allow.',
    cautions: 'Provider requirements, retention and cache hits must be verified. Caching does not reduce literal input size or justify unnecessary context; do not reorder content that depends on instruction precedence.',
    verify: 'Compare cached-input usage and latency under representative repeated requests, while checking behavior and tenant isolation.',
  },
];
