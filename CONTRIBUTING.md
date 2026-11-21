# Contributing to Iqra

1. Start from an up-to-date `main` and create a branch for your change.
2. Follow the [local setup](README.md#run-locally). Work in `app/` and use `npm ci` to install the locked dependencies.
3. Run the unit tests and production build. Run the relevant Playwright tests for changes to user flows. For visual changes, check phone and desktop widths, light and dark themes, and right-to-left content where applicable.
4. Record user-facing changes under **Unreleased** in the [changelog](CHANGELOG.md). Include verification results and any outstanding device checks in the pull request.

Keep the UI copy plain and use the existing design tokens. The app loads secondary pages and sections on demand to keep the initial bundle small. Keep signing keys, credentials, and personal PDFs out of Git.

See the [documentation index](docs/README.md) for architecture and deployment details.
