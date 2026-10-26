# Releasing TokenDiff

The prepared initial version is **v0.1.0**. This guide does not imply that a tag, release, Marketplace listing, or hosted smoke test already exists.

## Validate the candidate

Use Node 24. From a checkout with the intended changes:

```sh
npm ci
npm run build
npm run check
npm audit --omit=dev --audit-level=high
```

`npm run check` is credential-free. It checks types, tests, reproducibility of the shipped bundle and third-party notices, both context-mode fixture builds, release metadata, and common credential patterns. The audit requires registry access. The credential-pattern check is limited to release-related files and does not inspect Git history.

Review `CHANGELOG.md` and `docs/optimization-knowledge.md`. Keep `package.json` and `package-lock.json` versions synchronized. Keep the full `LICENSE`, project `NOTICE`, source files, build scripts, lockfile, generated bundle, and third-party notices together in the release. GPL-3.0-or-later is selected for TokenDiff; dependency licenses remain separate.

## Commit and push — maintainer commands

Agents must ask before running any Git command. Commit and push commands are for the maintainer to execute. No release script invokes Git.

Inspect all staged changes, including the archived external evaluation. Stage only files you intend to release:

```sh
git status --short
git add -A
git diff --cached --stat
git diff --cached --check
git diff --cached --name-only
git commit -m "chore: prepare TokenDiff v0.1.0 for launch"
git push origin HEAD
git rev-parse HEAD
```

Use the resulting full commit SHA as the Action reference for the hosted smoke test. This does not require a published tag or Marketplace listing. `git add -A` stages all changes; review the list carefully and exclude unrelated work and private evaluation artifacts.

## Run a hosted PR smoke test

1. In a test repository that can access `umer901/TokenDiff`, copy [the example workflow](../examples/tokendiff.yml) to `.github/workflows/tokendiff.yml`. Replace `YOUR_RELEASE_SHA` with the candidate's full pushed SHA.
2. Configure the selected provider's Actions secret and explicit model variable. Keep the `pull_request` trigger and minimal permissions.
3. Put a simple pipeline on the base branch, then open a same-repository PR introducing a duplicate tool call or repeated model-facing evidence. Changes must appear in the PR diff; an unchanged inefficient baseline is out of scope.
4. Confirm the Action completes, writes a job summary and one bot comment, reports the intended head revision, and offers source-grounded findings with guidance links.
5. Push another change and check that the same comment updates. Revert the regression and check the next review. Confirm an empty-key run reports `skipped`; a provider failure reports `error`, not a clean review.
6. Inspect coverage and provider usage. Archive reports only if their source excerpts are appropriate for the repository's artifact access policy.

Existing tests exercise these boundaries with mocked GitHub APIs; they do not substitute for this hosted test. The latest expanded Gemini evaluation stopped on rate limits. Recheck architecture categories and deletion-only findings when quota allows:

```sh
npm run eval:live -- --context-mode=repository --fixture=python-removed-model-routing
npm run eval:live -- --context-mode=repository --fixture=python-unconditional-expensive-stage
```

Set the documented `TOKENDIFF_PROVIDER`, `TOKENDIFF_MODEL`, and `TOKENDIFF_API_KEY` environment variables first. Live calls can consume provider quota. Do not commit their reports or credentials.

## Publish when the candidate is accepted

After CI and the hosted smoke test pass, tag the exact accepted commit. Replace `VERIFIED_COMMIT_SHA` below; do not reuse an existing version tag:

```sh
git tag -a v0.1.0 VERIFIED_COMMIT_SHA -m "TokenDiff v0.1.0"
git push origin v0.1.0
```

On GitHub, draft a release from `v0.1.0` and use the changelog as release notes. Confirm the target commit and describe the advisory/model-quality limitations. Update the changelog heading with the actual publication date as part of the release process.

For Marketplace, make the Action repository public, verify the Action name is available, and complete GitHub's publishing form and developer agreement. See [GitHub's publishing instructions](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace). Enable private vulnerability reporting in repository settings and verify the route described in `SECURITY.md`.

Consumers should pin a full release commit SHA. Do not create or move a `v1` compatibility tag for the initial `v0.1.0` release. npm publication is disabled intentionally. This repository has no automatic publishing workflow.
