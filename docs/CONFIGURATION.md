# Configuration

Configuration schema is defined in [src/types.ts](../src/types.ts); validation/defaults live in [src/config.ts](../src/config.ts). Start from [Unity mobile](../examples/unity-mobile.json) or [Node](../examples/node.json).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Config .\examples\unity-mobile.json -Project 'D:\Games\MyUnityGame'
```

`-Project` overrides the sample project path. Relative `project` and `workspace` values in a config are resolved against the config file's directory. Omitting `workspace` selects `<project>/.agentkit`. A workspace cannot equal or contain the project root. Once initialized, edit `.agentkit/agentkit.config.json`; project wrappers use that file explicitly.

## Important settings

| Setting | Default / behavior |
| --- | --- |
| `profile` | `auto`; detects Unity/Node, otherwise generic |
| `unity.editorPath` | Optional; set the actual Unity executable for batch tests |
| `unity.mcpUrl` | `http://127.0.0.1:8080/mcp`; local HTTP(S) only |
| `unity.instance` | Optional exact MCP project-instance identifier |
| `unity.timeoutMs` | 15000 |
| `context.maxChars` / `maxItems` | 10000 / 8 |
| `scan.maxFileBytes` | 16 MiB |
| `scan.exclude` | Git, generated workspace, caches, Unity Library/Temp, dependencies/build outputs |
| `testing.defaultMode` | `basic` |
| `testing.runner` | Unity `mcp`; Node/generic `commands`; `batch` is opt-in |
| `testing.timeoutMs` | 180000; Unity sample uses 600000 |
| `testing.noMistakes.enabled` | `true`; only invoked after full project checks pass |
| `testing.noMistakes.timeoutMs` | 60000 by default; samples use 900000 for native gate work |
| `testing.modes.basic/full` | Each has `platforms` and explicit `commands` |

Supplying `scan.exclude` replaces the list; preserve generated/dependency directory exclusions. A saved config retains its explicit settings when the package updates. Re-running setup does not reset user-configured test modes. Runtime timeout is a real limit, not proof of successful testing.

## Explicit verification recipes

For a Node native test project:

```json
{
  "testing": {
    "runner": "commands",
    "modes": {
      "basic": {
        "platforms": [],
        "commands": [
          { "id": "typecheck", "executable": "node", "args": ["node_modules/typescript/bin/tsc", "--noEmit"] },
          { "id": "node-tests", "executable": "node", "args": ["--test", "--test-reporter=tap", "{tests}"], "resultFormat": "node-tap" }
        ]
      },
      "full": {
        "platforms": [],
        "commands": [
          { "id": "typecheck", "executable": "node", "args": ["node_modules/typescript/bin/tsc", "--noEmit"] },
          { "id": "node-tests", "executable": "node", "args": ["--test", "--test-reporter=tap", "{tests}"], "resultFormat": "node-tap" }
        ]
      }
    }
  }
}
```

This is a fragment to merge into an initialized config. Recipes use explicit executable/argument arrays, without a shell. A command without `resultFormat` is an exit-code check, not evidence that tests ran. Supported test formats are `node-tap` and `nunit`; NUnit recipes require the actual `testResults` artifact path. `cwd` defaults to the project; optional recipe `timeoutMs` sets its limit. For `{tests}`, basic selects explicit/inferred native Node tests; full uses all inventoried native tests.

Auto-detection recognizes the exact trusted package script form `node --test tests/*.test.ts` (also matching supported JS variants) and a local TypeScript check. It does not execute arbitrary scripts encountered in `package.json` or documents. Other frameworks need their own documented recipe/artifact contract.

Unity platforms are `EditMode` and/or `PlayMode`. Batch tests run against an isolated project copy; no authoring copy-back occurs. [Testing](TESTING.md) explains limitations and native full-mode prerequisites.

## Command-line overrides and output

Common flags: `--project`, `--workspace`, `--config`, `--json`, `--full`, `--help`. Verification also accepts `--mode`, `--runner`, repeated `--test`, `--changed`, `--platform`, and `--task`. Use help for the selected command; irrelevant flags are rejected. `--full` expands CLI output and is different from `verify --mode full`.

Memory lives in workspace files. Keep credentials in your agent/client's normal credential store, not config, memory or shared logs. Account/model routing is outside this release.
