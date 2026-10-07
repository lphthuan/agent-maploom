# Getting started

## Requirements and release files

Windows 10/11 with PowerShell and network access for the first setup is the validated path. Git is optional when installing from ZIP. Bootstrap supplies Node.js 24+ and pnpm if needed. Unity projects also need the appropriate Editor/license/build modules. Configure Unity MCP and Unity Test Framework separately for live tests.

Download the versioned Windows source ZIP and `SHA256SUMS.txt` from [Releases](https://github.com/lphthuan/agent-maploom/releases). Check its hash against the listed entry:

```powershell
Get-FileHash .\agent-maploom-v0.2.0-windows-source.zip -Algorithm SHA256
Expand-Archive .\agent-maploom-v0.2.0-windows-source.zip -DestinationPath .\tools
cd .\tools\agent-maploom-0.2.0
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Project 'D:\Games\MyUnityGame'
```

The ZIP includes source, documentation and bootstrap. Dependencies/helpers are fetched on setup. It is not a self-contained offline executable.

## What changes in the target project

Setup writes root `AGENTS.md`, preserved rules (if any), `.vscode/tasks.json` when safely mergeable, and an ignore entry for an internal workspace. Other generated files and installed helpers live under `.agentkit/` by default. Unity C#, scenes, prefabs, packages and settings are not modified by setup.

The map links `SYSTEM_MAP.md`, `CONTEXT_INDEX.md`, `CURRENT.md`, `TASK_BRIEF.md`, `COMMANDS.md` and `TESTING.md`. The report is `.agentkit/setup-report.json`; its local review page is `.agentkit/docs/SETUP.html`. Read `helpers.results` and `userActions` in the report: ready helper installation is separate from Unity readiness.

Open your target project and ask the agent to read `AGENTS.md`. For apps that do not recognize this convention, explicitly name the file. A fresh clone of AgentMaploom itself has no generated state: bootstrap it with `-Project .` before following the generated map.

## Preview and optional attachment

After toolkit dependencies are installed:

```powershell
.\agent-maploom.ps1 setup --plan --project 'D:\Games\MyUnityGame' --json
```

`setup --plan` describes helper steps and remaining user actions without installing helpers or attaching AGENTS. The CLI may create its local workspace/lock directory; this is not an absolute no-write preview.

To generate workspace tools/maps without attaching root AGENTS or VS Code tasks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Project 'D:\Games\MyUnityGame' -NoAttach
```

Use `-SkipHelpers` to install the toolkit core and generate maps without Graft/Memory/Lavish/No-mistakes installation. Review and full native verification will remain unavailable until their helpers are installed. `-Offline` requires a previous successful online installation and matching package caches; it cannot fetch missing dependencies or runtime archives.

## npm-format tarball

For an existing Node.js 24+ installation containing npm, download `agent-maploom-0.2.0.tgz` and verify its checksum. Install in a dedicated tools directory:

```powershell
mkdir agent-tools
cd agent-tools
npm install --ignore-scripts --no-audit --no-fund 'C:\Downloads\agent-maploom-0.2.0.tgz'
.\node_modules\.bin\agent-maploom.cmd --help
.\node_modules\.bin\agent-maploom.cmd setup --apply --project 'D:\Games\MyUnityGame'
```

On macOS/Linux, the corresponding local executable is `./node_modules/.bin/agent-maploom`. The CLI path is experimental there. The tarball provides the CLI runtime; the Windows source ZIP supplies bootstrap, the frozen lockfile and contributor scripts. The tarball is hosted on GitHub Releases, not the npm registry; `npm install agent-maploom` is not the documented installation path for this release.

## First session and next session

```powershell
# Run in the target project.
node .agentkit/agentkit.mjs doctor --offline
node .agentkit/agentkit.mjs task --task feature-1 --goal 'Your precise requested change'
node .agentkit/agentkit.mjs context 'symbols or terms from the requested change'
# Inspect source/dependencies, then implement.
node .agentkit/agentkit.mjs verify --mode basic --test Actual.Tests.Class
node .agentkit/agentkit.mjs checkpoint --task current --done 'What actually completed' --next 'What remains'
node .agentkit/agentkit.mjs handoff --task current
# Next session:
node .agentkit/agentkit.mjs resume --task current
```

For a Node project, replace the test filter with `tests/actual.test.ts` or use `--changed src/file.ts`. Basic mode keeps mandatory checks even when selecting only relevant tests. Resume shows drift/unresolved operations; it does not replay interrupted commands. Provide all items you want to retain when replacing a checkpoint list.

## Local review and optional MCP registration

```powershell
node .agentkit/agentkit.mjs review open
node .agentkit/agentkit.mjs review poll
node .agentkit/agentkit.mjs review reply 'Handled the feedback'
node .agentkit/agentkit.mjs review stop
```

Lavish opens the generated local HTML page. Polling consumes feedback and saves it in `outputFile`; read that whole file before responding. An active polling agent is required; this does not wake a closed app. Review does not automatically publish/share project documents.

Setup generates `mcp-config.example.json` and `codex-mcp.example.toml` inside the workspace. Merge the relevant entries into your chosen client's settings if you want Unity/Memory MCP. They are examples, not active registrations. CLI memory and the Memory MCP graph are separate stores.

## Troubleshooting, moving and removal

| Symptom | Action |
| --- | --- |
| Missing runtime/dependency | Rerun online bootstrap; `-Offline` only reuses caches |
| Helper install fails | Read the reported setup log; inspect `resume` before retrying |
| Unity unavailable | Open the correct project/Editor; configure MCP endpoint/instance; inspect `doctor` |
| `AGENTS.override.md` exists | Resolve this higher-priority instruction file before attachment |
| Preserved rules conflict | Compare root AGENTS and preserved rules manually; no automatic replacement |
| Basic reports blocked | Supply an actual test/filter or explicit recipe; do not treat blocked as pass |
| Full reports blocked | Follow [native gate prerequisites](TESTING.md) |
| Toolkit folder moved | Run setup from the new folder to regenerate wrapper/task paths |
| Existing tasks are JSONC | Import generated `.agentkit/vscode-tasks.json` entries manually |

To remove integration, first back up any useful memory/evidence. Restore root rules from the preserved file if appropriate, remove only `AgentMaploom:`/legacy `AgentKit:` tasks, remove the generated ignore entry, and then delete the configured workspace/tools directory. Check the absolute target path before deleting; an external workspace may sit outside the game project. Removing the workspace does not uninstall your Unity Editor or agent app.
