# External project evaluation — October 25, 2026

Historical feedback copied from another project. Paths and reproduction commands below refer to that project; its evaluation JSON and source adapter are not included here. This report describes the pinned revision, not the current release candidate.

Evaluated on October 25, 2026 against
[`umer901/TokenDiff@30cce969f181013b23e4618dd156ad6f2bdada37`](https://github.com/umer901/TokenDiff/tree/30cce969f181013b23e4618dd156ad6f2bdada37).
Provider results, coverage, and usage are preserved in `tokendiff-evaluation.json` in the originating project.

**Verdict:** the integration works, including live Gemini requests and defensive
validation. The eight small synthetic fixtures pass on Gemini 3.5 Flash-Lite.
However, two deliberately inefficient changes to this application's pipeline
produced a missed finding and an invalid finding. Treat the current version as an
advisory reviewer, not a reliable guarantee that a change is efficient.

## What was integrated

`.github/workflows/tokendiff.yml` reviews pull requests using the pinned TokenDiff
Action. It uses repository context, limits source to `fraud_service/**/*.py`, and
archives its JSON report for seven days. It does not execute PR source code or
require a checkout step. The Gemini credential is separate from the application's
Groq credential; the fraud investigator still uses Groq or deterministic demo mode.

In the fraud-service repository's **Settings → Secrets and variables → Actions**, set:

- Secret: `GEMINI_API_KEY`.
- Variable: `TOKENDIFF_GEMINI_MODEL`, an explicit model available to the account.
  `gemini-3.5-flash-lite` completed the project reviews in this evaluation, with the
  quality limitations documented below. `gemini-3.8-flash` completed an initial
  smoke test but later encountered provider failures and quota limits.

The workflow intentionally has no automatic model fallback. Read `status` and
coverage alongside `findings-count`: zero findings with `error` or `skipped` is
not a successful review. A `completed` review still cannot guarantee detection.

TokenDiff's published entry point is a **pull-request Action**, not a per-commit
runtime profiler. Its reported token usage belongs to the review request. It does
not measure the fraud application's token consumption or savings.

## Pipeline changes used for the evaluation

- Compact JSON serialization for model-facing tool results, preserving Unicode.
- Account history sent to the model contains only the selected account's activity
  at or before the target timestamp. Full MCP results remain in the audit trace.
- Subsequent evidence-gathering rounds advertise only tools whose evidence is
  still missing. All three tools remain required before assessment.
- Restored the explicit demo-mode disclosure, which had been commented out and
  caused four existing API tests to fail.

The updated fraud service passes **40 tests**, including checks for temporal
filtering, unchanged audit evidence, Unicode preservation, and tool-schema
selection at the real SDK serialization boundary. Ruff checks also pass.

For the four seeded cases, serialized tool-result text became **6.1–6.7% smaller
in characters**. This measures one result from each of the three tools, not full
requests, tokens, latency, or cost. The normal three-tool sequence advertises 3,
then 2, then 1 tool schemas instead of 3 on every gathering round. The live Groq
provider was not called during this evaluation.

## Test results

| Check | Observed result |
| --- | --- |
| TokenDiff dependency install under Node 24 | Passed |
| Type checking and committed bundle verification | Passed; bundle matches source |
| TokenDiff automated tests | 66 passed |
| Synthetic fixture dry run | All 8 built successfully |
| Gemini 3.8 Flash initial prompt-growth smoke test | Correct finding |
| Gemini 3.8 Flash full fixture run | 1 passed, 4 provider errors; stopped after quota exhaustion; 3 not attempted |
| Gemini 2.5 Flash compatibility probe | HTTP 404: model unavailable to new users, despite appearing in the model list |
| Gemini 3.5 Flash-Lite synthetic suite | All 8 matched expected categories |
| Actual pipeline improvement, Flash-Lite | Completed; no findings; no budget omissions |
| In-memory tripled tool output, repository mode | Completed; missed the injected prompt growth |
| Same tripled output, diff mode | Completed; missed it again |
| In-memory duplicate MCP call, repository mode | Invalid finding; repeated diagnostic run also invalid |
| Same duplicate call, diff mode | Invalid finding |

The deliberately inefficient controls existed only in the local runner's memory;
they were never written into the application. The evaluation did not create a PR,
publish a GitHub comment, configure repository secrets, or exercise a hosted
Actions job. Those GitHub boundaries are covered by TokenDiff's tests rather than
an end-to-end hosted run here.

## Issues and suggestions

### 1. Same-file dependency context is missing

`src/context.ts` takes nearby changed excerpts and adds related **other files**.
It excludes changed paths from supporting-file discovery, so repository mode does
not automatically supply referenced helpers elsewhere in the same changed file.

In the project controls, `model_tool_output()` was called near the changed line,
but its definition was absent from the supplied excerpts. The reviewer therefore
did not see that it returns a JSON string. Both context modes missed the deliberate
`bridge.model_tool_output(call.name, result) * 3` regression. Missing helper context
is a plausible contributor; these runs do not establish it as the sole cause.

**Suggested improvement:** prioritize referenced definitions within changed files
before unrelated supporting files. Preserve before/after comparisons and budget
accounting. Add these full-project controls to the evaluation suite; the tiny
fixtures alone did not expose the problem.

### 2. Correct diagnoses can be lost to evidence-format errors

In the diagnostic duplicate-call run, the model correctly identified two adjacent
`await bridge.call(call.name, arguments)` invocations. It declared lines 315–317,
but copied nine evidence lines covering 315–323. `validateFindings()` correctly
rejected the mismatch, and the entire review became `error` with zero findings.

**Suggested improvement:** give excerpts stable IDs and explicit line labels, then
construct evidence from validated source ranges instead of asking the model to
reproduce both a range and an exact quote. Consider a single bounded repair request
for invalid locations. If retaining valid findings from a mixed response, report
`partial`, include rejection reasons, and never silently accept unsupported evidence.

### 3. Provider errors need more useful sanitized diagnostics

TokenDiff collapsed the Gemini 2.5 Flash retirement/access error into a generic
"check model availability and structured-output support" message. A direct,
redacted transport diagnostic was needed to discover the actual HTTP 404 reason.
Model-list membership did not establish model access.

**Suggested improvement:** expose HTTP status, safe provider reason codes, attempt
count, and elapsed time. Preserve actionable model-retirement and access guidance
without logging credentials, full request bodies, or arbitrary raw SDK errors.

### 4. Retry handling can waste a limited free quota

`src/providers.ts` retries every HTTP 429 with fixed one- and two-second delays.
It does not distinguish permanent quota exhaustion from temporary throttling or
honor a provider-specified retry delay. Requests that time out may also consume quota.
The Gemini 3.8 evaluation encountered timeouts, HTTP 503, and quota exhaustion.

**Suggested improvement:** distinguish hard quota failures from retryable limits,
honor bounded `Retry-After`/retry metadata, and report per-attempt outcomes. The
existing behavior of returning `error` rather than a clean review is appropriate.

### 5. Expand evaluation and distribution readiness

Add realistic multi-function Python cases, long tool transcripts, repeated runs,
invalid-evidence cases, and intentional safety work. Track detection misses,
false positives, evidence-validity rate, provider errors, latency, and review usage
separately. Eight synthetic examples are a smoke suite, not a quality benchmark.

A supported local CLI for commit/working-tree comparison would match the intended
"review a commit" workflow better than requiring internal-module adapters. The
upstream README also states that no release or project license has been selected;
choose those before promoting the Action for wider reuse.

## Reproduce locally

Use Node 24 and install TokenDiff's dependencies in a checkout at the evaluated
revision. From that checkout, its documented checks are:

```bash
npm ci
npm run typecheck
npm test
npm run check:bundle
npm run eval:live -- --dry-run
```

From this fraud-service directory, configure the local adapter:

```bash
export TOKENDIFF_SOURCE=/absolute/path/to/TokenDiff
export TOKENDIFF_MODEL=gemini-3.5-flash-lite
read -rs TOKENDIFF_API_KEY
export TOKENDIFF_API_KEY
```

Enter the key when `read` waits for input; it will not be echoed. The adapter reads
Git but does not stage, commit, push, or contact GitHub. It compares tracked,
existing Python files under `fraud_service/` and `tests/` against `HEAD`, then limits
model context to `fraud_service/**/*.py`. It does not cover untracked/deleted files
or replace TokenDiff's full PR handling. `--base=<commit>` selects another baseline.

```bash
# Build context without any provider request.
node --import "$TOKENDIFF_SOURCE/node_modules/tsx/dist/loader.mjs" \
  scripts/review_pipeline.mjs --dry-run

# Review actual working-tree changes.
node --import "$TOKENDIFF_SOURCE/node_modules/tsx/dist/loader.mjs" \
  scripts/review_pipeline.mjs --report=/tmp/tokendiff-actual.json

# Deliberately inefficient, in-memory controls.
node --import "$TOKENDIFF_SOURCE/node_modules/tsx/dist/loader.mjs" \
  scripts/review_pipeline.mjs --control=prompt-growth \
  --report=/tmp/tokendiff-prompt-control.json

node --import "$TOKENDIFF_SOURCE/node_modules/tsx/dist/loader.mjs" \
  scripts/review_pipeline.mjs --control=redundant-tool-call \
  --report=/tmp/tokendiff-tool-control.json
```

Add `--context-mode=diff` to compare the smaller context mode. A missed control or
provider/validation error exits nonzero. Normal review findings remain advisory.
The report identifies controls explicitly. Live runs send selected source to
Google and use the account's quota; the adapter does not configure billing or
switch models automatically.

To run TokenDiff's own live fixture suite from its checkout:

```bash
export TOKENDIFF_PROVIDER=gemini
npm run eval:live -- --report=/tmp/tokendiff-fixtures.json
unset TOKENDIFF_API_KEY
```

For provider behavior, consult Google's [Interactions documentation](https://ai.google.dev/gemini-api/docs/interactions-overview)
and [model pricing](https://ai.google.dev/gemini-api/docs/pricing). Account eligibility,
quota, and model availability must be checked for the account used by the workflow.
