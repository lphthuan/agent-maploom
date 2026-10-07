import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { appendJournal, exists, now, readJson, safePath, writeJson } from './io.ts';
import { runProcess } from './process.ts';
import { projectInfo } from './project.ts';
import { scan } from './scan.ts';
import type { ToolkitConfig } from './types.ts';
import { installNoMistakes, nativeEntry, noMistakesPin } from './native-tool.ts';

export const toolPins={graft:{package:'@nanonets/graft',version:'0.21.1',entry:'dist/cli.js',source:'https://github.com/trailhq/Graft'},
  lavish:{package:'lavish-axi',version:'0.1.83',entry:'dist/cli.mjs',source:'https://github.com/kunchenguid/lavish-axi'},
  memory:{package:'@modelcontextprotocol/server-memory',version:'2026.8.31',entry:'dist/index.js',source:'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'}} as const;
export type ToolName=keyof typeof toolPins | 'no-mistakes';
export const toolkitRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const toolkitCli=path.join(path.dirname(fileURLToPath(import.meta.url)),path.extname(fileURLToPath(import.meta.url))==='.ts'?'cli.ts':'cli.js');
const graftWorker=path.join(path.dirname(fileURLToPath(import.meta.url)),'adapters',path.extname(fileURLToPath(import.meta.url))==='.ts'?'graft-worker.ts':'graft-worker.js');
export function toolDirectory(config:ToolkitConfig,name:ToolName) {return safePath(config.workspace,'tools',name);}
export function toolEntrypoint(config:ToolkitConfig,name:ToolName) {if(name==='no-mistakes') return nativeEntry(config);const pin=toolPins[name];return path.join(toolDirectory(config,name),'node_modules',pin.package,pin.entry);}
export async function packageManager() {
  const prefix=path.dirname(process.execPath);
  const candidates=[{kind:'npm',file:path.join(prefix,'node_modules','npm','bin','npm-cli.js')},
    {kind:'pnpm',file:path.resolve(prefix,'..','node_modules','pnpm','bin','pnpm.cjs')},
    {kind:'pnpm',file:path.join(toolkitRoot,'.cache','runtime','package-manager','node_modules','pnpm','bin','pnpm.cjs')},
    {kind:'pnpm',file:path.join(toolkitRoot,'node_modules','pnpm','bin','pnpm.cjs')}];
  for(const candidate of candidates) if(await exists(candidate.file)) return candidate;
  throw new Error('npm/pnpm JS entrypoint not found beside Node. Run bootstrap.ps1 or provide a Node installation containing npm.');
}
export async function setup(config:ToolkitConfig,apply:boolean,names:ToolName[]= ['graft','memory','lavish','no-mistakes'],offline=false) {
  const info=await projectInfo(config);
  const steps=[];
  for(const name of names) {
    if(name==='no-mistakes') continue;
    const pin=toolPins[name];if(!pin) throw new Error(`Unknown tool ${name}`);
    const directory=toolDirectory(config,name);const packageFile=path.join(directory,'node_modules',pin.package,'package.json');
    const installed=await exists(packageFile)?(await readJson<{version:string}>(packageFile)).version:undefined;
    steps.push({tool:name,package:pin.package,version:pin.version,directory,action:installed===pin.version && await exists(toolEntrypoint(config,name))?'reuse':'install',source:pin.source});
  }
  const userActions=[];
  if(info.profile==='unity' && !info.unityMcp) userActions.push('Add MCP for Unity through Unity Package Manager; scene/prefab/settings/package authoring remains user-managed.');
  if(info.profile==='unity' && !info.testFramework) userActions.push('Enable a compatible Unity Test Framework package in the Editor.');
  if(!apply) return {applied:false,steps:[...steps,...names.includes('no-mistakes')?[{tool:'no-mistakes',version:noMistakesPin.version,directory:toolDirectory(config,'no-mistakes'),source:noMistakesPin.source}]:[]],userActions,profile:info.profile,unityVersion:info.unityVersion};
  const pm=steps.some(step=>step.action==='install')?await packageManager():undefined;
  const results:{tool:ToolName;status:string;version?:string;directory?:string;log?:string;actual?:string;details?:string}[]=[];
  for(const step of steps) {
    if(step.action==='reuse') {results.push({...step,status:'reused'});continue;}
    const pin=toolPins[step.tool];await fs.mkdir(step.directory,{recursive:true});
    await writeJson(path.join(step.directory,'package.json'),{private:true,type:'module',dependencies:{[pin.package]:pin.version}});
    const log=safePath(config.workspace,'setup-logs',`${step.tool}-${now().replace(/[:.]/g,'-')}.log`);
    const args=pm!.kind==='pnpm'?[pm!.file,'install','--prod','--ignore-scripts','--store-dir',safePath(config.workspace,'package-store')]
      :[pm!.file,'install','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache',safePath(config.workspace,'package-cache')];
    if(offline) {if(pm!.kind!=='pnpm') throw new Error('Offline helper setup requires pnpm');args.push('--offline');}
    const operationId=`setup-${step.tool}-${randomUUID()}`;
    await appendJournal(config.workspace,{event:'operation-start',operationId,tool:step.tool,version:pin.version});
    const run=await runProcess(process.execPath,args,{cwd:step.directory,timeoutMs:300000,log});
    const packageFile=path.join(step.directory,'node_modules',pin.package,'package.json');
    const actual=await exists(packageFile)?(await readJson<{version:string}>(packageFile)).version:undefined;
    const status=run.exitCode===0 && !run.timedOut && actual===pin.version?'installed':'failed';
    await appendJournal(config.workspace,{event:'operation-finish',operationId,status,log});
    results.push({...step,status,log,actual});
    if(status==='failed') break;
  }
  if(names.includes('no-mistakes') && !results.some(result=>result.status==='failed')) {
    try { results.push({...await installNoMistakes(config,offline),tool:'no-mistakes'}); }
    catch(error) {results.push({tool:'no-mistakes',status:'failed',details:String(error)});}
  }
  const lock={schemaVersion:1,node:process.version,installedAt:now(),results,userActions,installScripts:false};
  await writeJson(safePath(config.workspace,'tool-lock.json'),lock);
  return {applied:true,results,userActions,status:results.some(result=>result.status==='failed')?'failed':'ready'};
}
export async function graftBuild(config:ToolkitConfig) {
  const entry=toolEntrypoint(config,'graft');if(!await exists(entry)) throw new Error('Graft is not installed. Run setup --apply --tool graft');
  const actual=(await readJson<{version:string}>(path.join(path.dirname(entry),'..','package.json'))).version;
  if(actual!==toolPins.graft.version) throw new Error('Graft version differs from the pinned adapter; run setup first');
  const output=safePath(config.workspace,'graft');const log=safePath(config.workspace,'graft-build.log');
  const inventory=await scan(config);
  const onlyDirs=[...new Set(inventory.files.filter(file=>['parsed','read'].includes(file.status) && /\.(cs|cpp|c|h|java|mm|m|ts|js)$/i.test(file.path)).map(file=>file.path.split('/')[0]))];
  const request=safePath(config.workspace,'graft-request.json');
  await writeJson(request,{module:path.join(path.dirname(entry),'index.js'),project:config.project,output,onlyDirs});
  const operationId=`graft-${randomUUID()}`;await appendJournal(config.workspace,{event:'operation-start',operationId,kind:'graft-build'});
  const result=await runProcess(process.execPath,[graftWorker,request],
    {cwd:config.workspace,timeoutMs:300000,log,env:{GRAFT_NO_GITIGNORE:'1',GRAFT_NO_IGNORE:'1',DO_NOT_TRACK:'1',CI:'1',GRAFT_API_KEY:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:''}});
  const graph=path.join(output,'.graph','wiring.json');
  await appendJournal(config.workspace,{event:'operation-finish',operationId,status:result.exitCode===0?'built':'failed',log});
  return {status:result.exitCode===0 && await exists(graph)?'built':'failed',exitCode:result.exitCode,graph:await exists(graph)?graph:null,log,
    note:'Pinned public Graft.graph API; structural build only, without CLI upkeep/init/hooks/LLM. Core map uses independent C#/TS parsers and Unity GUIDs.'};
}
