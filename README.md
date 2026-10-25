# TokenDiff

**AI pipeline efficiency code review for pull requests.**

TokenDiff identifies avoidable prompt growth, unnecessary agent handoffs, and potentially redundant tool calls introduced by a PR. Catch efficiency regressions during development, before they become recurring application costs.

It runs as a GitHub Action, reviews text-based code in any language, and uses your own **Gemini or OpenAI API key**. Findings are advisory and never fail the workflow. No TokenDiff account, backend, or application instrumentation is required.

## Example finding

TokenDiff maintains one PR comment and writes an Actions job summary. Each finding includes severity, confidence, a changed source location, exact evidence, likely impact, and a suggestion.

> **Redundant tool call — medium severity, high confidence**  
> `pipeline.ts:42` adds another lookup with the same input immediately after the existing lookup. Its result is appended to the same model context.  
> **Likely impact:** Repeats retrieval work and may duplicate input context.  
> **Suggestion:** Reuse the first result if both calls should retrieve the same data.

This is an illustrative finding, not a measured result. Extra calls and longer prompts can serve new functionality or safety requirements. TokenDiff asks the model to account for those tradeoffs and report only plausible regressions. It does not invent runtime token totals or cost savings.

## Quickstart: Gemini

1. Obtain a [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key). Add an Actions repository **secret** named `GEMINI_API_KEY` under **Settings → Secrets and variables → Actions**.
2. Add an Actions **variable** named `TOKENDIFF_GEMINI_MODEL` containing an explicit model ID available to your account. Choose a text model supporting [structured outputs through Interactions](https://ai.google.dev/gemini-api/docs/structured-output).
3. Add the workflow below as `.github/workflows/tokendiff.yml`. Replace `YOUR_ORG/TokenDiff@YOUR_RELEASE_SHA` with the published repository and a full commit SHA. This repository does not yet have a published release.

```yaml
name: TokenDiff
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: tokendiff-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Review AI pipeline efficiency
        id: tokendiff
        uses: YOUR_ORG/TokenDiff@YOUR_RELEASE_SHA
        with:
          provider: gemini
          model: ${{ vars.TOKENDIFF_GEMINI_MODEL }}
          api-key: ${{ secrets.GEMINI_API_KEY }}
```

No checkout step is needed: TokenDiff reads immutable source revisions through GitHub's API.

Gemini offers free quotas for eligible models/accounts. A key itself does not guarantee free calls: billing, availability, region, and quota depend on your project. TokenDiff never automatically switches providers or models. Consult [pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), and [data-use and regional terms](https://ai.google.dev/gemini-api/terms). Free-tier data handling varies by account and region; review those terms before sending private code.

## Quickstart: OpenAI

Use the same workflow, but create an `OPENAI_API_KEY` Actions secret and a `TOKENDIFF_OPENAI_MODEL` Actions variable, then replace the `with` block:

```yaml
with:
  provider: openai
  model: ${{ vars.TOKENDIFF_OPENAI_MODEL }}
  api-key: ${{ secrets.OPENAI_API_KEY }}
```

Choose a model available to your API account supporting the [Responses API and structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). API usage is billed by your provider. There is no automatic fallback.

## Context modes

**`diff` (default):** Changed hunks plus up to 20 surrounding lines from the before and after versions. The before version comes from the PR's merge base, not the current base branch tip. Added, deleted, and renamed files are supported. Pure renames without text changes require no AI review.

**`repository` (opt-in):** Also include up to 20 related unchanged files from the PR head. Selection ranks textual file/import references first, then shared path terms and directory proximity, with deterministic path ordering for ties. This is heuristic selection, not a complete dependency graph or a whole-repository audit.

```yaml
with:
  provider: gemini
  model: ${{ vars.TOKENDIFF_GEMINI_MODEL }}
  api-key: ${{ secrets.GEMINI_API_KEY }}
  context-mode: repository
  max-context-chars: '100000'
  include: |
    src/**
    prompts/**
    config/**
  exclude: |
    src/generated/**
    config/private/**
```

Changed code gets priority over supporting files. Both modes use the same character budget. Whole hunk pairs are retained where possible; optional surrounding lines are reduced before a hunk is omitted. Related files that do not fit are omitted. The report identifies coverage and omissions; an empty partial review is not an all-clear for omitted code.

## Inputs and outputs

| Input | Default | Description |
| --- | --- | --- |
| `provider` | Required | `gemini` or `openai`. |
| `model` | Required | Explicit model ID supported by the provider and account. |
| `api-key` | Empty | GitHub secret; empty keys skip review. |
| `github-token` | `${{ github.token }}` | Workflow token; use the standard GitHub Actions bot for comment updates. |
| `context-mode` | `diff` | `diff` or `repository`. |
| `include` | All eligible files | Newline-separated, case-sensitive globs relative to the repository root. |
| `exclude` | None additional | Extra newline-separated exclusions. Built-in exclusions always apply. |
| `max-context-chars` | `60000` | Serialized code-context characters; allowed range 1,000–1,000,000. |
| `max-output-tokens` | `4096` | Provider output-token limit; allowed range 256–32,768. May include reasoning tokens. |

The character budget includes file/excerpt metadata. System instructions and schema overhead are additional. It is not a token or dollar limit. Only selected excerpts are sent, even if larger source files were downloaded to compute their differences.

| Output | Description |
| --- | --- |
| `status` | `completed`, `partial`, `skipped`, or `error`. |
| `findings-count` | Validated findings; always interpret together with `status`. |
| `report-path` | Absolute JSON report path in the runner's temporary directory; empty if writing failed. |

The JSON report contains the schema version, reviewed revisions, findings, coverage lists, warnings, and provider-reported usage when available. Usage describes **TokenDiff's review request**, not application consumption. The file lasts only for the job unless a later step archives it. Reports contain source evidence, so treat an uploaded report as repository data.

## Coverage and failures

- Findings never fail the job. Invalid Action configuration fails with an actionable setup error.
- Missing keys produce `skipped`; no keyless heuristic review runs. Normal fork and Dependabot PRs do not receive repository secrets and may also lack comment permissions. See [GitHub's fork restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- Only `pull_request` events are supported. Other events, including `pull_request_target`, skip. Do not change triggers to work around withheld secrets.
- Provider authentication/model errors, exhausted quota, refusals, incomplete output, and invalid findings produce `error` plus an advisory warning. They never become a successful empty review.
- A run makes one model request, with at most two retries for transient HTTP/network failures. Attempts have 60-second deadlines; retry delays are one and two seconds. SDK retries are disabled. Timed-out requests may still consume quota.
- Base/head revisions are checked before review and immediately before publishing. Stale runs retain their revision-specific summaries/reports but do not overwrite the comment. Keep workflow concurrency cancellation enabled.
- Without comment write permission, the summary and JSON report remain available. Repeated runs update the marked comment authored by the GitHub Actions bot.

Resource limits: at most 100 eligible changed files are read per run in path order; files over 256 KiB are omitted; related context is limited to 20 files. GitHub's file-list/tree limits can also reduce coverage. Omissions appear in the report. An entirely excluded, unreadable, or over-budget change set skips the AI call.

## Source handling

Code goes directly from the runner to the selected AI provider. There is no TokenDiff backend or telemetry. Both adapters request `store: false`; this does not override provider retention or data-use terms.

The reviewing model receives no tools. Repository code is never executed, and its contents are treated as untrusted input. Findings are checked against supplied changed lines, and model prose is escaped for display. These checks verify evidence and locations; they cannot prove reasoning or eliminate false positives or prompt-injection risk.

Built-in exclusions cover common credentials (`.env*`, key/certificate containers, service-account and credential files), sensitive directories, dependencies/build outputs, lockfiles, common binary formats, and non-UTF-8 text. Symlinks and submodules are not followed. Old rename paths are also checked against exclusions.

These rules are not a general secret scanner. Use `include`/`exclude` to control which source may leave the runner. The supplied provider and GitHub tokens are masked and redacted from outgoing context and reports. Full contexts, provider responses, and raw SDK errors are not logged. Findings necessarily include source evidence.

## Development

Use Node 24 and npm. CI runs without API keys or live provider calls.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run check:bundle
npm run eval:live -- --dry-run
```

`dist/index.cjs` bundles the Action and dependencies for GitHub's Node 24 runtime. Keep it and its generated legal-notices file with source changes. `check:bundle` compares an in-memory build with existing files; it does not invoke Git or modify the bundle.

Modules separate GitHub access, context selection, providers, evidence validation, reporting, and orchestration. Credential-free tests cover those modules and bundled startup.

### Optional live evaluation

Eight synthetic fixtures include Python prompt growth, a TypeScript handoff, a Go duplicate call, and negative cases for intentional safety work, distinct arguments, unrelated changes, and pre-existing inefficiencies.

Set `TOKENDIFF_PROVIDER`, `TOKENDIFF_MODEL`, and `TOKENDIFF_API_KEY` in your shell environment without committing the key, then run:

```sh
npm run eval:live
# Or run just one fixture:
npm run eval:live -- --fixture=python-prompt-growth
# Save findings and provider usage for inspection (never the API key):
npm run eval:live -- --report=/tmp/tokendiff-live-results.json
```

This sends synthetic fixtures to the chosen provider and may incur charges or exhaust free quota. It prints category-level matches and exits nonzero on mismatches/errors. Evaluation stops on exhausted quota instead of sending the remaining fixtures; the optional JSON report records attempted cases and their full findings. The small fixture set is a smoke evaluation, not a precision/recall benchmark. Mocked tests validate integration, not model detection quality. `--dry-run` makes no API calls.

## Release preparation

Run the checks, build the bundle, and review the notices and documentation. Select a project license before public distribution; no project license has been selected here. Commit/push/tag operations and publishing are left to the maintainer. Consumers should pin a published full commit SHA. No release, tag, or Marketplace listing is created automatically.
