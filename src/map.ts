import path from 'node:path';
import { atomicWrite, markdownLink, md, safePath } from './io.ts';
import { writeDocumentIndex } from './doc-index.ts';
import { detectProfile } from './profile.ts';
import type { ProjectGraph, ToolkitConfig } from './types.ts';

const label=(value:string)=>value.replace(/["<>\[\]\\\r\n]/g,'_');
export const moduleSlug=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,'_');
export async function writeMap(config:ToolkitConfig,graph:ProjectGraph) {
  const docs=safePath(config.workspace,'docs'),profile=await detectProfile(config);
  const names=[...new Set([...graph.assemblies.map(a=>a.name),...graph.files.map(f=>f.assembly).filter(Boolean) as string[]])].sort();
  const sourceModules=new Map(graph.files.map(file=>[file.path,file.assembly]));
  const moduleEdges=[...new Set(graph.edges.filter(e=>['assembly-reference','import'].includes(e.kind)).map(e=>{
    const from=e.kind==='import'?sourceModules.get(e.from):e.from,to=e.kind==='import'?sourceModules.get(e.to):e.to;
    return from && to && from!==to?`${from}\0${to}`:'';
  }).filter(Boolean))];
  const displayed=names.slice(0,25),nodes=new Map(displayed.map((name,i)=>[name,`M${i}`]));
  const diagram=['```mermaid','flowchart LR',...displayed.map(n=>`    ${nodes.get(n)}["${label(n)}"]`),...moduleEdges.flatMap(edge=>{
    const [from,to]=edge.split('\0');return nodes.has(from)&&nodes.has(to)?[`    ${nodes.get(from)} --> ${nodes.get(to)}`]:[];
  }),'```'].join('\n');
  const index=await writeDocumentIndex(config,graph);
  const lines=[`# ${path.basename(config.project)} — system map`,'',`Project: ${config.project}`,`Profile: ${profile}`,`Fingerprint: ${graph.sourceHash}`,'',
    'Generated from C#/TS/JS syntax, declared imports, Unity assemblies and serialized GUID references. It identifies source locations and declared dependencies; it does not infer every runtime relation.', '',
    '## Start a change','',
    '1. Read preserved project rules if linked from AGENTS.md, then CURRENT.md/TASK_BRIEF.md.',
    `2. Search ${markdownLink('prior decisions and requirements',index.path)} and run the context/task command with the user goal.`,
    '3. Inspect the matching source, its incoming/outgoing dependencies and nearby tests before editing.',
    '4. Run the requested verification mode, refresh the map and checkpoint the next steps.', '',
    ...(profile==='unity'?['The Agent edits C#; the user owns scene, prefab and Unity settings.','']:[]),
    '## Modules','',diagram,'',`Diagram capped at 25 of ${names.length} modules. All module files are listed below.`,'',
    '| Module | Source files | Depends on |','| --- | ---: | --- |'];
  for(const name of names) {
    const files=graph.files.filter(f=>f.assembly===name);
    const dependencies=moduleEdges.filter(e=>e.startsWith(name+'\0')).map(e=>e.split('\0')[1]);
    lines.push(`| ${markdownLink(name,path.join(docs,'modules',moduleSlug(name)+'.md'))} | ${files.length} | ${md(dependencies.join(', ') || 'none declared locally')} |`);
    const module=[`# ${name}`,'',`Fingerprint: ${graph.sourceHash}`,`Dependencies: ${dependencies.join(', ') || 'none declared locally'}`,'',
      '| Source | Symbols | Tests |','| --- | ---: | ---: |',...files.map(f=>`| ${markdownLink(f.path,path.join(config.project,f.path))} | ${f.symbols?.length ?? 0} | ${f.testNames?.length ?? 0} |`), '',
      '## Symbol locations','',...files.flatMap(f=>(f.symbols ?? []).map(s=>`- ${markdownLink([s.namespace,s.name].filter(Boolean).join('.'),path.join(config.project,f.path),s.line)} (${s.kind})`)), '',
      '## Declared source dependencies','',...files.flatMap(f=>(f.imports ?? []).map(i=>`- ${markdownLink(f.path,path.join(config.project,f.path),i.line)} → ${i.target?markdownLink(i.target,path.join(config.project,i.target)):md(i.specifier)+' (external/unresolved)'}`)), ''];
    await atomicWrite(path.join(docs,'modules',moduleSlug(name)+'.md'),module.join('\n'));
  }
  if(profile==='unity') {
    lines.push('','## Scene/prefab wiring','');
    const assets=graph.files.filter(f=>/\.(?:unity|prefab)$/.test(f.path) && f.status==='read');
    for(const file of assets.slice(0,50)) lines.push(`- ${markdownLink(file.path,path.join(config.project,file.path))}: ${graph.edges.filter(e=>e.kind==='asset-reference'&&e.from===file.path).length} resolved references.`);
    if(assets.length>50) lines.push(`Display capped at 50 of ${assets.length} assets; ASSET_REFERENCES.md has all resolved references.`);
  }
  lines.push('','## Requirements and context','',markdownLink('Context/decision index',index.path),'','## Coverage','',
    ...Object.entries(graph.counts).map(([key,value])=>`- ${key}: ${value}`),'',
    'A syntax scan is not a compiler/test pass. TS aliases, dynamic calls, reflection, DI, events and Unity runtime wiring need source review/tests. Read coverage.json for omitted files and parse warnings.','');
  const output=path.join(docs,'SYSTEM_MAP.md');await atomicWrite(output,lines.join('\n'));
  await atomicWrite(path.join(docs,'ASSET_REFERENCES.md'),['# Declared asset references','','| Source | Target | Evidence |','| --- | --- | --- |',
    ...graph.edges.filter(e=>e.kind==='asset-reference').map(e=>`| ${markdownLink(e.from,path.join(config.project,e.from))} | ${markdownLink(e.to,path.join(config.project,e.to))} | serialized GUID |`),''].join('\n'));
  return {map:output,modules:names.length,documents:index.count,contextIndex:index.path,references:graph.edges.filter(e=>e.kind==='asset-reference').length,sourceHash:graph.sourceHash};
}
