import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectionError, HttpMcpClient, object } from './mcp.ts';
import { exists, readJson, slash } from './io.ts';
import type { ToolkitConfig } from './types.ts';
import { detectProfile } from './profile.ts';

const exec=promisify(execFile);
export async function projectInfo(config: ToolkitConfig) {
  const versionFile=path.join(config.project,'ProjectSettings','ProjectVersion.txt');
  const profile=await detectProfile(config);
  if(profile!=='unity') {
    const manifest=await exists(path.join(config.project,'package.json'))?await readJson<{dependencies?:Record<string,string>;devDependencies?:Record<string,string>}>(path.join(config.project,'package.json')):undefined;
    return {project:config.project,name:path.basename(config.project),profile,unityVersion:undefined,packages:{...manifest?.dependencies,...manifest?.devDependencies},unityMcp:undefined,testFramework:undefined};
  }
  if(!await exists(versionFile)) throw new Error(`Unity profile requires ProjectSettings/ProjectVersion.txt: ${config.project}`);
  const text=await fs.readFile(versionFile,'utf8');
  const unityVersion=/^m_EditorVersion:\s*(.+)$/m.exec(text)?.[1].trim() ?? 'unknown';
  const manifest=await readJson<{dependencies:Record<string,string>}>(path.join(config.project,'Packages','manifest.json'));
  return {project:config.project,name:path.basename(config.project),profile,unityVersion,packages:manifest.dependencies,
    unityMcp:manifest.dependencies['com.coplaydev.unity-mcp'],testFramework:manifest.dependencies['com.unity.test-framework']};
}
export async function editorExecutable(config: ToolkitConfig) {
  if(config.unity.editorPath) return await exists(config.unity.editorPath) ? config.unity.editorPath : undefined;
  const {unityVersion}=await projectInfo(config);
  if(!unityVersion) return undefined;
  const candidates=[`D:/Program Files/Unity Hub/Editors/${unityVersion}/Editor/Unity.exe`,
    path.join(process.env.ProgramFiles ?? 'C:/Program Files','Unity Hub','Editors',unityVersion,'Editor','Unity.exe')];
  for(const candidate of candidates) if(await exists(candidate)) return path.resolve(candidate);
  return undefined;
}
export async function inheritedInstructions(project: string) {
  const output: string[]=[];
  let current=path.resolve(project);
  while(true) {
    for(const name of ['AGENTS.override.md','AGENTS.md']) if(await exists(path.join(current,name))) {output.unshift(path.join(current,name));break;}
    const parent=path.dirname(current);if(parent===current) break;current=parent;
  }
  const home=process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex');
  for(const name of ['AGENTS.override.md','AGENTS.md']) if(await exists(path.join(home,name))) {output.unshift(path.join(home,name));break;}
  return output;
}
export async function gitChanged(project: string) {
  try {
    const {stdout}=await exec('git',['--no-optional-locks','-C',project,'status','--porcelain=v1','-z','--untracked-files=all'],{windowsHide:true,maxBuffer:4*1024*1024});
    const parts=stdout.split('\0').filter(Boolean);const files: string[]=[];
    for(let i=0;i<parts.length;i++) { const status=parts[i].slice(0,2);files.push(slash(parts[i].slice(3)));if(/[RC]/.test(status)) i++; }
    return files;
  } catch { return undefined; }
}
export async function unityIsRunningForProject(project: string) {
  const lock=path.join(project,'Temp','UnityLockfile');
  if(!await exists(lock)) return false;
  if(process.platform!=='win32') return true; // Conservatively refuse a possible active project.
  try {
    const literal=lock.replaceAll("'","''");
    const script=`$ErrorActionPreference='Stop'; $handle=[IO.File]::Open('${literal}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None); $handle.Dispose()`;
    await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});return false;
  } catch { return true; }
}
export async function doctor(config: ToolkitConfig, live = true) {
  const info=await projectInfo(config);const editor=await editorExecutable(config);
  const client=new HttpMcpClient(config.unity.mcpUrl,Math.min(config.unity.timeoutMs,5000));
  let mcp:Record<string,unknown>={status:'not-probed',url:config.unity.mcpUrl};
  if(live && info.profile==='unity') try {
    const resources=await client.resources();const tools=await client.tools();
    const stateUri=resources.find(resource=>resource.uri.endsWith('/editor/state'))?.uri;
    const state=stateUri ? await client.resource(stateUri) : undefined;
    mcp={status:'connected',url:config.unity.mcpUrl,tools:tools.map(tool=>tool.name),state};
  } catch(error) {mcp={status:'unavailable',url:config.unity.mcpUrl,reason:connectionError(error)};} finally {await client.close();}
  const {packages,...identity}=info;
  return { ...identity,packageCount:Object.keys(packages).length,workspace:config.workspace,node:process.version,editor:editor ?? null,instructions:await inheritedInstructions(config.project),
    changedFiles:await gitChanged(config.project),mcp:info.profile==='unity'?mcp:{status:'not-applicable'},scope:{agent:'any agent that reads AGENTS.md',code:info.profile==='unity'?'C#':'source code',scenePrefabSettings:'user-managed'},
    readiness:{scan:true,batchTests:Boolean(editor),mcpTests:mcp.status==='connected'},
    next: info.profile!=='unity'?['Read AGENTS.md; use context/task to locate code and prior decisions.']:mcp.status==='connected' ? ['Use a test filter for basic mode.'] : ['Start/connect MCP for Unity in the Editor, or use batch to test an isolated copy.'],
    checksAreNotTests:true };
}
