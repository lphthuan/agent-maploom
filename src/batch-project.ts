import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, exists, hash, readJson, safePath, writeJson } from './io.ts';
import { unityIsRunningForProject } from './project.ts';
import type { ProjectGraph, ToolkitConfig } from './types.ts';

const roots=['Assets/','Packages/','ProjectSettings/','Docs/','Tools/'];
export async function prepareBatchProject(config:ToolkitConfig,graph:ProjectGraph,runDir:string) {
  const target=safePath(config.workspace,'batch-project');
  if(await unityIsRunningForProject(target)) throw new Error('The isolated batch project is busy; inspect the prior Unity process before retrying');
  const marker=path.join(target,'agentkit-origin.json');
  if(await exists(marker)) {
    const origin=await readJson<{project:string}>(marker);
    if(origin.project!==config.project) throw new Error('Batch cache belongs to another project; use a separate workspace');
  }
  const selected=graph.files.filter(file=>['read','parsed','metadata'].includes(file.status) &&
    (roots.some(root=>file.path.startsWith(root)) || file.path==='AGENTS.md'));
  const manifest=await readJson<{dependencies:Record<string,string>}>(path.join(config.project,'Packages','manifest.json'));
  for(const dependency of Object.values(manifest.dependencies)) if(dependency.startsWith('file:')) {
    const packagePath=path.resolve(config.project,'Packages',dependency.slice(5));
    const relative=path.relative(config.project,packagePath).replaceAll('\\','/');
    if(relative.startsWith('../') || !roots.some(root=>relative.startsWith(root)))
      throw new Error(`Local package outside copied Unity roots: ${dependency}. Configure MCP or a portable package reference.`);
  }
  const wanted=new Set(selected.map(file=>file.path));
  async function prune(directory:string) {
    if(!await exists(directory)) return;
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file=safePath(target,path.relative(target,path.join(directory,entry.name)));
      if(entry.isDirectory() && !entry.isSymbolicLink()) await prune(file);
      else if(!wanted.has(path.relative(target,file).replaceAll('\\','/'))) await fs.rm(file,{force:true});
    }
  }
  for(const root of roots) await prune(safePath(target,root));
  const files=[];
  for(const record of selected) {
    const source=safePath(config.project,record.path),destination=safePath(target,record.path);
    const data=await fs.readFile(source);const digest=hash(data);
    if(record.status!=='metadata' && digest!==record.hash) throw new Error(`Source changed during batch snapshot: ${record.path}`);
    if(!await exists(destination) || hash(await fs.readFile(destination))!==digest) await atomicWriteBuffer(destination,data);
    files.push({path:record.path,sha256:digest,bytes:data.length});
  }
  const provenance={schemaVersion:1,project:config.project,batchProject:target,sourceHash:graph.sourceHash,files,omittedRoots:['Production','Library','Temp','Build','local tool caches']};
  await writeJson(marker,{project:config.project});
  const evidence=path.join(runDir,'batch-snapshot.json');await writeJson(evidence,provenance);
  await atomicWrite(path.join(target,'README.agentkit.txt'),'Generated isolated Unity test project. Never copy authoring changes back to the original project.\n');
  return {project:target,evidence};
}
async function atomicWriteBuffer(file:string,data:Buffer) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.agentkit.tmp';
  await fs.writeFile(temporary,data);
  await fs.rename(temporary,file);
}
