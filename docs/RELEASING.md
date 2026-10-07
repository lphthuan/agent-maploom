# Releasing AgentMaploom

## Local reproduction

Use Windows, Node.js 24+ and pinned pnpm. In a clean checkout:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm package
pnpm smoke:package
```

The packaging command reads the version from `package.json`, copies only the public allowlist, compiles the runtime into `lib/`, packs the npm-format tarball and creates a Windows source ZIP. Output is under `dist/`:

- `agent-maploom-v<version>-windows-source.zip`
- `agent-maploom-<version>.tgz`
- `release-manifest.json`: public file hashes and archive metadata
- `SHA256SUMS.txt`: SHA-256 hashes for the release assets

The clean-install smoke check verifies checksums, inspects archive contents, installs the tarball in a temporary directory, exercises its public CLI on a separate Unity-shaped fixture and runs actual Node verification/context/resume checks. It does not launch a Unity Editor or real model. Its local report lives in `.cache/`, outside release assets.

## Publish

After reviewing changes, update version/changelog/release notes and commit. The manually dispatched GitHub release workflow checks out an existing version tag, repeats checks, builds and tests packages, creates a draft, uploads all assets and publishes only after successful uploads. Workflow permissions are scoped to release contents. It uses `GITHUB_TOKEN`; no npm publication occurs.

```powershell
git tag v0.2.0
git push origin main
git push origin v0.2.0
gh workflow run release.yml --ref main -f tag=v0.2.0
```

These are maintainer publication steps, not commands to run automatically when reading this document. Never force-replace a release tag or overwrite a published asset silently. Use a new version for fixes to a shipped package.

Release body should link English/Vietnamese README and getting-started instructions, describe Windows support, setup prerequisites, verification actually run and known limitations. Use annotated evidence, not claims of a native full gate or mobile build that did not happen.

## Public content boundary

The allowlist in `scripts/release-files.ts` is used for the source ZIP and publication review. The npm `files` list covers executable source and public documentation. The source ZIP supplies the frozen lockfile, bootstrap and contributor test/package scripts; the npm tarball uses pinned runtime dependencies from its manifest. Generated `.agentkit/`, `.cache/`, `.vscode/`, private pilot configuration, research/video material and local evidence are excluded. Do not use an unreviewed `git add .` when local project data is present.
