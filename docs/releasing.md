# Releasing Iqra

Use semantic versions in the form `MAJOR.MINOR.PATCH`. Increment the patch for fixes, the minor for compatible features, and the major for breaking changes. The canonical version is in `app/package.json`. Android reads it for its display version, and CI continues to use the workflow run number as Android’s version code.

1. From `app/`, run `npm version <version> --no-git-tag-version` to update the package and lockfile.
2. Move the relevant entries in [CHANGELOG.md](../CHANGELOG.md) from **Unreleased** into a dated version section. Review the changes and run the [project checks](../CONTRIBUTING.md).
3. Merge to `main` and confirm the Pages deployment and Android build. Follow the [acceptance checklist](deploy-and-test.md) for the affected features.
4. Tag the verified commit as `v<version>` and push that tag. Use the changelog entries as release notes. The Android workflow maintains the separate rolling `android-latest` release.

The Android workflow publishes `iqra.apk` when signing secrets are configured and `iqra-debug.apk` otherwise. Updates must use the same signing key. Keep backups of the signing key and credentials outside the repository.
