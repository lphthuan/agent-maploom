# Verification policy

`basic` runs related tests plus mandatory project checks. It never invokes No-mistakes. `full` runs configured suites and then the native No-mistakes gate. Choose a mode by configuration or `verify --mode ...`; changing the mode does not remove mandatory checks.

## Results and evidence

Each run writes `runs/<run-id>/report.json`, logs and artifacts under the configured workspace. Reports bind evidence to source fingerprints before/after execution. Node TAP and Unity NUnit/MCP results must show a positive executed-test count with no failures/cancellations. Zero tests, missing artifacts and failures cannot pass. Source drift marks evidence stale at handoff.

Exit codes: `0` success, `1` failed/stale, `2` invalid request or blocked verification. A missing prerequisite is `blocked`; skipped/omitted checks must be reported. A setup-ready result is not test evidence.

For Node basic mode, pass an actual test file or `--changed` source files. Declared import impact is transitive; dynamic relationships need human/agent judgment. For Unity, pass an actual class/name filter or allow supported type inference. An unreliable filter means blocked rather than a misleading empty test pass.

## Unity

MCP runner verifies identity, readiness and compile state before testing. Configure the localhost endpoint and optional instance. The Editor must have the intended project open, compatible MCP and Test Framework packages, and a usable test environment.

Batch runner requires an exact Editor path and makes a separate project copy. It does not open a second Editor on the original project and does not copy authoring data back. PlayMode tests using `WaitForEndOfFrame` may require normal Editor/Game view behavior and can be blocked in batch. Mobile/device/render/performance checks require their actual recipes and evidence; C# tests cannot substitute for them.

## Enable native No-mistakes explicitly

Ordinary setup installs the pinned native binary and workspace-scoped configuration. It does not run upstream `init`, because initialization modifies Git remotes and user-level skills.

Prerequisites: Git repository with `origin`, committed changes on a feature branch, initialized native gate, and a supported working authenticated agent CLI. Your model/agent may incur its own usage; configure that agent's budget separately. A CLI binary being detected does not prove successful login or available quota.

From the target project, for the default workspace on Windows:

```powershell
$env:NM_HOME = (Resolve-Path .agentkit/no-mistakes).Path
$env:NO_MISTAKES_TELEMETRY = 'off'
$env:NO_MISTAKES_NO_UPDATE_CHECK = '1'
& .\.agentkit\tools\no-mistakes\no-mistakes.exe init
node .agentkit/agentkit.mjs no-mistakes doctor
node .agentkit/agentkit.mjs verify --mode full --task current
```

Run `init` only when you intend its documented remote/skill changes. For an external workspace, use its actual paths. Keep workspace `no-mistakes/config.yaml` aligned with your agent choice and timeout; defaults disable automatic fix retries and intent publication.

The adapter always skips rebase/push/PR/CI, retains intent/review/test/document/lint, and does not auto-approve gates. Native fixes stay in native worktrees; they are not automatically applied to your checkout. Passing requires completed required steps for the correct native run/current submitted head, not just exit code zero. Inspect native logs and unresolved journal operations before retrying.

`testing.noMistakes.enabled=false` explicitly omits the gate and records that omission. It is useful when running project suites alone but is not a full No-mistakes pass.

## Release verification

Maintainers run the TypeScript check, local regression suite and clean package smoke check. CI runs fixture tests on Windows and Linux; those tests do not launch Unity or a real model. A native gate has not been claimed as passed for the initial release. See [Releasing](RELEASING.md).
