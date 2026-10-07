import path from 'node:path';
import { exists, readJson } from './io.ts';
import type { ToolkitConfig } from './types.ts';

export async function detectProfile(config: ToolkitConfig): Promise<'unity'|'node'|'generic'> {
  if(config.profile && config.profile!=='auto') return config.profile;
  if(await exists(path.join(config.project,'ProjectSettings','ProjectVersion.txt'))) return 'unity';
  if(await exists(path.join(config.project,'package.json'))) return 'node';
  return 'generic';
}

// Only known executable recipes are generated. Scripts found in documents/package.json
// are described in the map, never executed automatically by setup.
export async function configureProfile(config: ToolkitConfig) {
  const profile=await detectProfile(config);config.profile=profile;
  if(profile!=='unity' && config.testing.runner!=='commands') config.testing.runner='commands';
  if(profile!=='node') return;
  const manifest=await readJson<{scripts?:Record<string,string>}>(path.join(config.project,'package.json'));
  const commands=config.testing.modes;
  if(commands.basic.commands.length || commands.full.commands.length) return;
  const checks=[];
  if(await exists(path.join(config.project,'tsconfig.json')) && await exists(path.join(config.project,'node_modules','typescript','bin','tsc')))
    checks.push({id:'typecheck',executable:process.execPath,args:[path.join(config.project,'node_modules','typescript','bin','tsc'),'--noEmit']});
  // Native Node tests: a trusted recipe for the exact script shape, without a shell.
  const native=/^node\s+--test\s+(tests?\/\*\.test\.(?:ts|js|mjs))$/;
  const tests=native.exec(manifest.scripts?.test?.trim() ?? '');
  if(tests) checks.push({id:'node-tests',executable:process.execPath,args:['--test','--test-reporter=tap','{tests}'],resultFormat:'node-tap' as const});
  commands.basic={platforms:[],commands:checks};commands.full={platforms:[],commands:checks.map(check=>({...check,args:[...check.args]}))};
}
