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

