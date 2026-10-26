# Contributing to TokenDiff

Use Node 24 and npm. After cloning the repository:

```sh
npm ci
npm run check
```

`npm run check` runs type checks, credential-free tests, bundle verification, fixture dry runs, and release-file checks. It makes no provider requests. After changing Action source or dependencies, regenerate the distributable files first:

```sh
npm run build
npm run check
```

Include `dist/index.cjs`, `dist/index.cjs.LEGAL.txt`, and `dist/THIRD_PARTY_NOTICES.md` with relevant source changes. CI checks that they match source and installed dependencies. Keep `package-lock.json` with dependency changes. This repository distributes a GitHub Action, not an npm package; `private: true` is intentional.

Keep reviews scoped to PR regressions. Preserve evidence validation, bounded requests, credential masking, advisory failure behavior, and the treatment of repository text as untrusted data. Include positive and negative fixtures when changing detection behavior. Tests must not use real credentials or contact providers.

For live evaluation, follow the [README](README.md#optional-live-evaluation). Use synthetic or explicitly authorized source, keep reports outside the repository, and inspect reasoning as well as category matches. Do not add API keys, private code, or raw provider request/response logs to issues or PRs.

For research guidance changes, follow [the catalog maintenance guide](docs/optimization-knowledge.md#maintaining-the-corpus). Prefer primary sources, retain caveats, and do not turn benchmark savings into application claims.

In a PR, explain the concrete behavior change, relevant verification, and remaining limitations. Follow the repository rule: agents must ask before running Git commands and must leave commit/push commands for the maintainer to execute.

Contributions are provided under GPL-3.0-or-later, the project's license. Preserve third-party notices and attribution.
