# Changelog

## 0.1.0 — prepared for release

Initial public release of TokenDiff, an advisory GitHub Action for AI pipeline efficiency regressions.

- Review immutable PR revisions using your own Gemini or OpenAI key.
- Detect avoidable prompt growth, redundant tool calls, unnecessary handoffs, and model-routing or pipeline-structure regressions.
- Select bounded diff context or opt into repository context with same-file helpers and related files.
- Ground suggestions in a bundled research catalog, with canonical citations, tradeoffs, and verification plans.
- Validate finding locations and construct evidence from supplied source.
- Update one PR comment and write an Actions summary plus a JSON report.
- Skip missing credentials; report unavailable reviews, quota limits, and incomplete coverage explicitly.
- Ship a standalone Node 24 bundle, credential-free checks, and opt-in live evaluation.

### Known limitations

Model quality varies. A completed review is not a guarantee that no regression exists. Retrieval and dependency discovery are heuristic. The latest expanded live evaluation did not complete because of provider rate limits; follow-up instructions for deletion-only citations and architecture categories have automated coverage but still need live revalidation. OpenAI transport is tested with mocked APIs; live evaluations have used Gemini. Hosted PR permissions and comment behavior should be smoke-tested on the release candidate.

TokenDiff does not profile runtime consumption, apply fixes, review standalone commits, or block merges on findings.
