import path from 'node:path';
import { inside, readJson } from './io.ts';
import type { ToolkitConfig } from './types.ts';
import { configureProfile } from './profile.ts';

export function defaults(project: string, workspace?: string): ToolkitConfig {
  return {
    schemaVersion: 1,
    profile: 'auto',
    project: path.resolve(project), workspace: path.resolve(workspace ?? path.join(project, '.agentkit')),
    unity: { mcpUrl: 'http://127.0.0.1:8080/mcp', timeoutMs: 15000 },
    scan: { exclude: ['.git', '.agentkit', '.tools', '.utmp', '.vs', '.idea', 'Library', 'Temp', 'obj', 'Logs', 'Build', 'Builds', 'node_modules', '.cache', 'pilot', 'dist', 'coverage'], maxFileBytes: 16 * 1024 * 1024 },
    context: { maxChars: 10000, maxItems: 8 },
    testing: { defaultMode: 'basic', runner: 'mcp', timeoutMs: 180000, noMistakes: { enabled: true, timeoutMs: 60000 },
      modes: { basic: { platforms: ['EditMode'], commands: [] }, full: { platforms: ['EditMode', 'PlayMode'], commands: [] } } }
  };
}
export async function loadConfig(options: { project?: string; workspace?: string; config?: string }): Promise<ToolkitConfig> {
  const configPath = options.config && path.resolve(options.config);
  const input = configPath ? await readJson<Partial<ToolkitConfig>>(configPath) : {};
  const base = configPath ? path.dirname(configPath) : process.cwd();
  const project = path.resolve(base, options.project ?? input.project ?? process.cwd());
  const workspaceInput = options.workspace ?? input.workspace;
  const result = defaults(project, workspaceInput ? path.resolve(base, workspaceInput) : undefined);
  if (inside(result.workspace, result.project)) throw new Error('Workspace must not equal or contain the project root');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('Unsupported config schemaVersion');
  if (input.profile) result.profile = input.profile;
  if (!['auto','unity','node','generic'].includes(result.profile!)) throw new Error('Unsupported project profile');
  if (input.unity) result.unity = { ...result.unity, ...input.unity };
  if (input.scan) result.scan = { ...result.scan, ...input.scan };
  if (input.context) result.context = { ...result.context, ...input.context };
  if (input.testing) {
    result.testing = { ...result.testing, ...input.testing, modes: {
      basic: { ...result.testing.modes.basic, ...input.testing.modes?.basic },
      full: { ...result.testing.modes.full, ...input.testing.modes?.full }
    } };
  }
  if (!['basic', 'full'].includes(result.testing.defaultMode)) throw new Error('testing.defaultMode must be basic or full');
  if (!['mcp', 'batch', 'commands'].includes(result.testing.runner)) throw new Error('Unsupported test runner');
  for (const limit of [result.context.maxChars, result.context.maxItems, result.scan.maxFileBytes, result.unity.timeoutMs, result.testing.timeoutMs])
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('Limits and timeouts must be positive numbers');
  const endpoint = new URL(result.unity.mcpUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || !['http:', 'https:'].includes(endpoint.protocol))
    throw new Error('Unity MCP must use a local HTTP endpoint');
  await configureProfile(result);
  return result;
}
