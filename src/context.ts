import path from 'node:path';
import { promises as fs } from 'node:fs';
import { markdownLink, redact } from './io.ts';
import { scan } from './scan.ts';
import { recall } from './state.ts';
import type { ToolkitConfig } from './types.ts';
import { documentRole } from './doc-index.ts';

export async function codeContext(config:ToolkitConfig,query:string,within?:string) {
  if(!query.trim()) throw new Error('context requires a question/search term');
  const terms=[...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(term=>term.length>1))];
  const graph=await scan(config);
  const prefix=within?.replaceAll('\\','/').replace(/\/$/,'');
  const hits:{file:string;score:number;line:number;text:string}[]=[];
  for(const file of graph.files) {
    if(!['parsed','read'].includes(file.status) || file.kind==='unity-meta' || (prefix && file.path!==prefix && !file.path.startsWith(prefix+'/'))) continue;
    const content=await fs.readFile(path.join(config.project,file.path),'utf8');const lowered=content.toLowerCase();
    const title=(file.path+' '+(file.symbols??[]).map(symbol=>symbol.namespace+'.'+symbol.name).join(' ')).toLowerCase();
    let score=terms.reduce((sum,term)=>sum+(title.includes(term)?10:0)+(lowered.includes(term)?2:0),0);
    if(!score) continue;
    if(file.kind==='documentation') {
      const role=documentRole(file.path,content);
      score+=role==='current'?8:role==='implemented'?5:role==='historical'?-2:role==='source'?-3:0;
    }
    const lines=content.split(/\r?\n/);
    const rankedMethods=(file.symbols??[]).filter(symbol=>['method','constructor','function'].includes(symbol.kind))
      .map(symbol=>({symbol,score:terms.filter(term=>symbol.name.toLowerCase().includes(term)).length}))
      .filter(item=>item.score>0).sort((a,b)=>b.score-a.score || a.symbol.line-b.symbol.line);
    const lineScores=lines.map((line,index)=>({index,score:terms.filter(term=>line.toLowerCase().includes(term)).length})).sort((a,b)=>b.score-a.score || a.index-b.index);
    const match=rankedMethods[0]?.symbol.line!==undefined ? rankedMethods[0].symbol.line-1 : lineScores[0]?.index ?? 0;
    const start=Math.max(0,match-3);
    hits.push({file:file.path,score,line:start+1,text:lines.slice(start,start+18).map((line,index)=>`${start+index+1}: ${line}`).join('\n')});
  }
  hits.sort((a,b)=>b.score-a.score || a.file.localeCompare(b.file,'en'));
  const memories=await recall(config,query,3);
  const sections=[`# Context: ${redact(query)}`,`Source fingerprint: ${graph.sourceHash}`,''];
  for(const memory of memories) sections.push(`Memory: ${redact(memory.text)}`,`Sources: ${memory.sources.join(', ')}`,'');
  const selected=hits.slice(0,config.context.maxItems);
  const targets=selected.filter(hit=>graph.files.find(f=>f.path===hit.file)?.status==='parsed').map(hit=>hit.file);
  const related=[...new Set(graph.edges.filter(e=>e.kind==='import' && (targets.includes(e.from)||targets.includes(e.to))).flatMap(e=>[e.from,e.to]))].filter(f=>!targets.includes(f)).slice(0,12);
  if(targets.length) sections.push(`Candidate change locations (search evidence, inspect before editing): ${targets.join(', ')}`,
    `Declared dependents/dependencies: ${related.join(', ') || 'none resolved'}`,'');
  for(const hit of selected) sections.push(markdownLink(hit.file,path.join(config.project,hit.file),hit.line),'```text',redact(hit.text),'```','');
  const full=sections.join('\n');const truncated=full.length>config.context.maxChars;
  const text=truncated ? full.slice(0,Math.max(0,config.context.maxChars-100))+'\n[Truncated; narrow the question or use --in.]' : full;
  return {text,sourceHash:graph.sourceHash,candidates:hits.length,returned:selected.length,truncated,charCount:text.length,targets,related,locations:selected.map(({file,line,score})=>({file,line,score}))};
}
