# Security

TokenDiff reads repository source and sends selected context directly to the configured AI provider. It gives the model no tools and does not execute reviewed source. Findings and reports can contain source excerpts. File exclusions are not a general secret scanner; review the README's source-handling and provider-data-use limitations before using private repositories.

## Reporting a vulnerability

Use the repository's **Security → Advisories → Report a vulnerability** option if private vulnerability reporting is enabled. If it is unavailable, open an issue asking the maintainer to enable a private reporting channel; do not include exploit details, credentials, or private source in that issue. No dedicated security email address or response-time commitment is currently published.

Useful private reports describe the affected commit/version, impact, and a minimal reproduction with synthetic inputs. Never include live provider or GitHub tokens.

## Supported versions

Security fixes target the latest released version. Older versions do not have a separate maintenance commitment. Pin a reviewed full commit SHA and update it to adopt fixes.
