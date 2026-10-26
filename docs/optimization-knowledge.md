# Optimization knowledge used by TokenDiff

TokenDiff retrieves maintainer-written technique summaries **before** its single review request. The bundled corpus combines research, engineering blogs, and conventional optimization advice. Source research was checked on **2026-10-26**; corpus version: **2026-10-26.1**.

This is local lexical RAG: code signals retrieve relevant technique records, which are supplied alongside the PR context to ground suggestions. It does not crawl the web, fetch repository-provided URLs, call an embeddings service, or require a vector database. Source code is sent only to the configured reviewing provider.

## Sources and techniques

| Technique | Primary source | Application and essential qualification |
| --- | --- | --- |
| Reuse or deterministic computation | [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization) | Replace avoidable calls with known-equivalent results or code; preserve side effects, freshness, and authorization. |
| Task-specific smaller-model routing | [RouteLLM](https://arxiv.org/abs/2406.18665v4) | Route bounded tasks using evaluated quality criteria; model names and low frequency alone do not establish suitability. |
| Quality-gated escalation | [FrugalGPT](https://arxiv.org/abs/2305.05176v1) | Escalate to a stronger model only when a cheaper stage fails a reliable gate; count both stages when evaluating cost. |
| Bounded pipeline stages | [Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Separate suitable subtasks and pass compact intermediate results; additional calls can outweigh benefits. |
| Prompt compression | [LLMLingua](https://arxiv.org/abs/2310.05736v2) | Remove redundancy or evaluate compression; preserve constraints, exact values and required evidence. |
| Query-aware context selection | [LongLLMLingua](https://arxiv.org/abs/2310.06839v2) | Select relevant retrieved material; test recall and multi-hop questions instead of assuming a universal chunk limit. |
| Compact agent state | [Effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Pass decisions and relevant references rather than replaying histories; retain audit data and test continuity. |
| Bounded tool results | [Writing effective tools](https://www.anthropic.com/research/writing-tools-for-agents) | Filter or paginate model-facing results with explicit continuation; avoid silently removing necessary facts. |
| Stable prompt prefixes | [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Preserve reusable prefixes where semantics allow; cache behavior is provider-dependent and does not reduce literal prompt size. |

These application suggestions are TokenDiff's engineering interpretations. Papers establish techniques under their experimental conditions, not savings or correctness guarantees for the reviewed application. No published percentage is transferred into a finding.

## Retrieval and bounds

The catalog lives in `src/knowledge/catalog.ts`. Retrieval tokenizes identifiers (including camel case) and source text, matching curated terms. A match on a changed line scores four; a match elsewhere scores one. Repetition does not increase a term's score. Ties are ordered by technique ID. The conventional reuse/computation record is included as a fallback; up to four additional matching records are selected.

Guidance is capped at **five records and 8,500 serialized characters**. This is additional to the configured code-context budget, so it cannot displace changed code. JSON reports include the corpus version, retrieved IDs, and actual guidance character count. System instructions, output schema, and JSON envelope overhead remain additional. Retrieval is heuristic: unfamiliar terminology or a PR touching many concerns can leave a useful technique unselected.

Repository text can affect ranking but cannot add techniques, replace their contents, or supply citation URLs. Retries use the same retrieved set. Models are instructed to consult the records before proposing changes. Local checks enforce selected IDs and response structure; they cannot prove that a model followed the instructions or applied a paper correctly.

## Findings and scope

In addition to `prompt-growth`, `agent-handoff`, and `redundant-tool-call`, reviewers can report:

- `model-routing`: the PR introduces an avoidable routing regression, such as removing a bounded task's smaller-model path.
- `pipeline-structure`: the PR unnecessarily couples stages or makes expensive work unconditional.

The scope remains **introduced or worsened PR regressions**. Merely finding a large model, a rare task, or a complex workflow is not enough. New functionality and safety checks are not automatically inefficiencies. Decomposition is justified only when context isolation, conditional work, or task-specific model selection plausibly offsets added calls.

Each finding includes a concrete `suggestion`, a `tradeoff`, and a `verification` plan, plus one to three `techniqueIds`. The validator rejects unknown or unretrieved IDs and constructs `references` using the catalog. Comments render canonical source links, never model-generated links. Evidence still comes from validated changed source ranges.

For example, a removed classification route could produce:

> **Suggestion:** Restore the `task.kind == "label"` route to the evaluated smaller classifier. Validate its label schema and send rejected or ambiguous cases to the existing reasoner; retain the reasoner for analysis tasks.
>
> **Tradeoff:** Routing and fallback add complexity; a poorly calibrated gate may accept incorrect labels or escalate too often.
>
> **Verify:** Compare label accuracy and fallback rate on representative and difficult cases, then measure total review-independent application usage and latency.
>
> **Guidance:** RouteLLM / FrugalGPT, if those records were retrieved.

This is illustrative, not a measured result or an automatic code change. Low-consequence work may be a candidate for a smaller model when quality requirements permit. Low-frequency work may be too small a cost contributor to justify an extra routing system, and rare safety-critical tasks can still require the strongest checks.

## Maintaining the corpus

1. Read the primary source, including its limitations; use a versioned paper URL where possible.
2. Add an original, concise summary with applicability, cautions, and a verification plan. Distinguish a research result from an engineering extrapolation. Avoid copying passages, benchmark savings promises, and volatile model-price recommendations.
3. Add targeted terms and positive/negative retrieval tests. Keep the five-record and 8,500-character limits intact.
4. Bump `KNOWLEDGE_VERSION`, update this document, and rebuild the Action bundle.
5. Run type checks, tests, bundle verification, and fixture dry runs. Use opt-in live evaluation to inspect citation relevance and suggestion quality, not just category matches.

```sh
npm run eval:live -- --context-mode=repository --fixture=python-removed-model-routing
npm run eval:live -- --context-mode=both --repeat=3 --report=/tmp/tokendiff-guidance.json
```

The credential-free tests validate retrieval, citation restrictions, prompt construction, and reporting. Live fixture category matches do not establish the quality or safety of every proposed optimization.
