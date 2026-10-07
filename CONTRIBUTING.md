# Contributing to AgentMaploom

Read [README](README.md), [Architecture](docs/ARCHITECTURE.md) and [Development](docs/DEVELOPMENT.md). Reproducible bug reports and focused improvements to Unity C# onboarding are welcome.

Use Node.js 24+ and pnpm 11.19.0:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
```

Alternatively, bootstrap the toolkit itself:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Project . -SkipHelpers
```

Keep TypeScript compatible with Node's erasable type syntax. Add regression tests for meaningful behavior, especially failed/blocked/zero-test/stale results, project-rule preservation, path boundaries and interrupted operations. Unity fixtures are not live gameplay evidence.

For packaging changes, also run `pnpm package` and `pnpm smoke:package`; the latter installs the actual tarball and exercises a separate project. See [Releasing](docs/RELEASING.md).

Open a focused issue or pull request. Describe the problem, resulting behavior and checks actually run. Remove credentials and private project content from evidence. Generated `.agentkit/`, caches, runtime downloads and local pilot data belong outside Git.

Preserve the split between Agent C# changes and user-authored Unity scenes, prefabs, settings and packages. Pin integrations and keep account access or global changes explicit.
