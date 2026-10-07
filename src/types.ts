export interface CommandRecipe {
  id: string;
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  testResults?: string;
  resultFormat?: 'nunit' | 'node-tap';
}
export interface ToolkitConfig {
  schemaVersion: 1;
  project: string;
  workspace: string;
  profile?: 'auto' | 'unity' | 'node' | 'generic';
  unity: { editorPath?: string; mcpUrl: string; instance?: string; timeoutMs: number };
  scan: { exclude: string[]; maxFileBytes: number };
  context: { maxChars: number; maxItems: number };
  testing: {
    defaultMode: 'basic' | 'full';
    runner: 'mcp' | 'batch' | 'commands';
    timeoutMs: number;
    noMistakes?: { enabled: boolean; timeoutMs: number };
    modes: Record<'basic' | 'full', { platforms: string[]; commands: CommandRecipe[] }>;
  };
}
export interface RuntimeContext { config: ToolkitConfig; configPath?: string; }
export interface SourceSymbol {
  id: string; name: string; kind: string; file: string; line: number; endLine: number;
  namespace: string; bases: string[];
}
export interface FileRecord {
  path: string; bytes: number; hash?: string; kind: string; assembly?: string;
  status: 'parsed' | 'read' | 'metadata' | 'excluded' | 'error'; reason?: string;
  symbols?: SourceSymbol[]; usings?: string[]; guid?: string; guidRefs?: string[];
  testNames?: string[]; parseErrors?: number;
  imports?: { specifier: string; line: number; target?: string }[];
}
export interface GraphEdge {
  from: string; to: string; kind: 'assembly-reference' | 'asset-reference' | 'inherits' | 'import';
  file: string; line?: number; certainty: 'declared' | 'name-match';
}
export interface AssemblyRecord {
  name: string; path: string; guid?: string; references: string[]; noEngineReferences: boolean;
  includePlatforms: string[];
}
export interface ProjectGraph {
  schemaVersion: 1; project: string; sourceHash: string; generatedAt: string;
  parser: string; files: FileRecord[]; assemblies: AssemblyRecord[]; edges: GraphEdge[];
  counts: Record<string, number>; changedFiles: string[];
}
export interface CheckResult {
  id: string; status: 'passed' | 'failed' | 'blocked' | 'skipped';
  durationMs: number; details: string; exitCode?: number | null; executedTests?: number;
  evidence: string[];
}
export interface VerificationReport {
  schemaVersion: 1; runId: string; project: string; taskId?: string;
  mode: 'basic' | 'full'; startedAt: string; finishedAt: string;
  sourceHash: string; sourceHashAfter: string;
  status: 'passed' | 'failed' | 'blocked' | 'stale'; checks: CheckResult[];
  omitted: string[]; instructions: string[];
}
export interface TaskState {
  schemaVersion: 1; id: string; project: string; goal: string; done: string[];
  next: string[]; decisions: string[]; wiring: string[]; updatedAt: string;
  sourceHash: string; lastRunId?: string;
}
export interface MemoryRecord {
  id: string; project: string; text: string; sources: string[]; createdAt: string;
  supersedes?: string;
}
