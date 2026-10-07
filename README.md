# AgentMaploom

**Project setup, code maps, and local context for AI coding agents.**

[Tiếng Việt](README.vi.md) · [Getting started](docs/GETTING_STARTED.md) · [Configuration](docs/CONFIGURATION.md) · [Releases](https://github.com/lphthuan/agent-maploom/releases)

AgentMaploom prepares a project so a coding agent can enter through one short `AGENTS.md`, locate relevant code and earlier decisions, run verification, and save progress for the next session. It is designed first for Unity C# projects, with TypeScript/JavaScript support for working on the toolkit itself.

Use it from Codex, VS Code, Antigravity, or another app/CLI that can read local files and run commands. Your chosen agent and model do the coding; AgentMaploom supplies the project map and tools. If your app does not discover `AGENTS.md` automatically, ask it to read that file at the start of the session.

> **v0.2.0 is an early release.** Windows is the tested setup platform. macOS/Linux CLI support is experimental. Scene, prefab, Unity settings, and mobile build configuration remain under your control.

## Quick start on Windows

Download and extract `agent-maploom-v0.2.0-windows-source.zip` from [v0.2.0](https://github.com/lphthuan/agent-maploom/releases/tag/v0.2.0), or clone:

```powershell
git clone https://github.com/lphthuan/agent-maploom.git
cd agent-maploom
```

Run setup against your project:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Project 'D:\Games\MyUnityGame'
```

This process-scoped execution option allows the downloaded script to run without changing the machine's execution policy. Keep the extracted toolkit folder: project wrappers refer to its location. After moving/updating the toolkit, run setup again to refresh those paths.

The first setup needs internet access. Bootstrap finds Node.js 24+ or downloads a checksum-verified Windows runtime, installs pinned pnpm and toolkit dependencies, installs the helpers below, and generates the project map. It reuses compatible tools on later runs. Structural scans do not require an API key.

Once setup finishes, open your **game project** and tell your agent:

> Read AGENTS.md. Run task/context with my goal, inspect candidate code and dependencies, implement the C# change, verify in basic mode, and checkpoint progress. I will handle scene, prefab and Unity configuration.

If installation fails, read the reported log, run `resume`, and reconcile unfinished operations before retrying. [Troubleshooting](docs/GETTING_STARTED.md).

## What setup installs and creates

| Component | Purpose |
| --- | --- |
| Node.js 24+ / pnpm 11.19.0 | Runtime and pinned dependency installation |
| C# Tree-sitter WASM / TypeScript parser | Symbols, source locations and declared relationships |
| Graft 0.21.1 | Additional structural graph without model calls |
| Memory MCP 2026.8.31 | Optional local knowledge graph server |
| Lavish 0.1.83 | Local HTML review and feedback |
| No-mistakes 1.84.0 | Native verification gate, used only in `full` mode |
| Root `AGENTS.md` | Short entry map; existing rules are preserved |
| `.agentkit/` | Maps, context index, config, task state, memory, logs and evidence |
| VS Code tasks | Status, map, basic/full verification and review commands |

AXI principles guide compact CLI output and on-demand help. AXI is a design approach rather than a separate package installed by this toolkit.

Setup preserves existing root rules in `Docs/Agent/PROJECT_RULES.md` and links them from the map. Existing VS Code tasks are retained; JSONC files remain intact, with generated tasks available for import. An existing `AGENTS.override.md` blocks map attachment until you resolve it.

**You still provide** Unity Editor/license, required Android/iOS modules and SDKs, your coding agent, and any agent credentials. Unity MCP and Unity Test Framework must be installed/configured in your project to use their runner. Setup reports missing components; it does not edit game packages, scene or prefab assets to install them.

## Work on a change

Run these from the project root **after setup**:

```powershell
node .agentkit/agentkit.mjs
node .agentkit/agentkit.mjs task --task damage-cooldown --goal 'Add a contact damage cooldown'
node .agentkit/agentkit.mjs context 'contact damage cooldown'
# Ask your coding agent to implement the change after inspecting the source.
node .agentkit/agentkit.mjs verify --mode basic --test Game.Tests.DamageTests
node .agentkit/agentkit.mjs checkpoint --task current --done 'Implemented cooldown' --next 'Test gameplay in Editor'
node .agentkit/agentkit.mjs handoff --task current
```

Replace the example test name with an actual test. For Node, use a test file or `--changed src/file.ts`. `context` retrieves at most 8 files / 10,000 characters by default; candidate locations require source inspection. Use `--json` for complete structured results, `--full` for expanded CLI summaries, and `<command> --help` for options.

Return in another session with `resume --task current`. Store a sourced lesson with `memory add "lesson" --source docs/decision.md`. Supplied checkpoint lists replace earlier lists. Saved context is a local continuation aid; it does not restore an app's hidden state or entire chat transcript.

## Verification modes

| Mode | Behavior |
| --- | --- |
| `basic` | Relevant tests and mandatory project checks; logs/evidence; no No-mistakes |
| `full` | Configured suites followed by No-mistakes intent/review/test/document/lint |

No confident basic test selection means `blocked`. Tests must execute and produce valid results; compiler success alone is not a gameplay test. Evidence is tied to the source fingerprint and becomes stale after source changes.

Installing No-mistakes does not initialize or pass its gate. Full requires Git, `origin`, committed work on a feature branch, explicit gate initialization, and a working authenticated supported agent CLI. Initialization also changes Git remotes and user-level skills. Read [Testing](docs/TESTING.md) before enabling it. The adapter skips rebase/push/PR/CI and never auto-approves or merges native fixes.

## More documentation

- [Getting started](docs/GETTING_STARTED.md): preview setup, offline reuse, npm-format tarball, local review and troubleshooting.
- [Configuration](docs/CONFIGURATION.md): Unity/Node profiles and verification recipes.
- [Testing](docs/TESTING.md): evidence rules, Unity limits and full prerequisites.
- [Architecture](docs/ARCHITECTURE.md): setup, map, retrieval and handoff flow.
- [Contributing](CONTRIBUTING.md): development checks and contribution scope.
- [Releasing](docs/RELEASING.md): reproduce packages, checksums and clean-install checks.

The release includes an npm-format `.tgz` for Node.js 24+ users. It is distributed via GitHub Releases; this version is **not published to the npm registry**.

## Scope and limits

Maps parse C#/TS/JS syntax, declared imports/assemblies and Unity GUID references. Runtime calls, reflection, events, dependency injection and gameplay still need source review and tests. Excluded, unreadable, binary and oversized files are reported in `coverage.json`.

Local CLI memory and the optional Memory MCP graph are separate stores. No account/model switching, automatic chat migration, agent teams or background wake-up is implemented. External tools/model usage may require separate accounts and budgets; core setup/retrieval does not call a model.

Generated state stays on your machine. Downloads and optional HTML styling use upstream network services. Keep `.agentkit/` outside Git and credentials outside task memory/shared logs.

## License and acknowledgements

AgentMaploom is [MIT licensed](LICENSE). Dependencies/helpers retain their own licenses: [Third-party notices](THIRD_PARTY_NOTICES.md). Thanks to [AXI](https://axi.md/), [Graft](https://github.com/trailhq/Graft), [Lavish](https://github.com/kunchenguid/lavish-axi), [No-mistakes](https://github.com/kunchenguid/no-mistakes), [MCP Memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory), [Tree-sitter](https://github.com/tree-sitter/tree-sitter) and [TypeScript](https://github.com/microsoft/TypeScript).
