import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendJournal, atomicWrite, exists, markdownLink, now, readJson, redact, safePath, writeJson } from './io.ts';
import { scan } from './scan.ts';
import type { MemoryRecord, TaskState, ToolkitConfig, VerificationReport } from './types.ts';

export function taskId(value: string) {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw new Error('Task id must be 1-64 letters/digits/dot/underscore/hyphen, starting with a letter or digit');
  return value;
}
export async function readTask(config: ToolkitConfig, id: string): Promise<TaskState> {
  if(id==='current') {
    const pointer=await readJson<{taskId:string;project:string}>(safePath(config.workspace,'current.json'));
    if(pointer.project!==config.project) throw new Error('Current task belongs to another project');
    id=pointer.taskId;
  }
  const state=await readJson<TaskState>(safePath(config.workspace,'tasks',taskId(id),'state.json'));
  if(state.project!==config.project) throw new Error('Task belongs to another project');
  return state;
}
export async function checkpoint(config: ToolkitConfig, input: {id:string;goal?:string;done?:string[];next?:string[];decisions?:string[];wiring?:string[]}) {
  let existing:TaskState|undefined;
  if(input.id==='current') existing=await readTask(config,input.id);
  else if(await exists(safePath(config.workspace,'tasks',taskId(input.id),'state.json'))) existing=await readTask(config,input.id);
  const id=existing?.id ?? taskId(input.id);
  const graph=await scan(config);
  let lastRunId=existing?.lastRunId;
  const lastPath=safePath(config.workspace,'last-run.json');
  if(await exists(lastPath)) {
    const last=await readJson<{runId:string;taskId?:string}>(lastPath);
    if(last.taskId===id) lastRunId=last.runId;
  }
  const state:TaskState={schemaVersion:1,id,project:config.project,goal:input.goal ?? existing?.goal ?? '',
    done:input.done?.filter(value=>value.trim()) ?? existing?.done ?? [],next:input.next?.filter(value=>value.trim()) ?? existing?.next ?? [],decisions:input.decisions?.filter(value=>value.trim()) ?? existing?.decisions ?? [],
    wiring:input.wiring?.filter(value=>value.trim()) ?? existing?.wiring ?? [],updatedAt:now(),sourceHash:graph.sourceHash,lastRunId};
  if(!state.goal) throw new Error('First checkpoint requires --goal');
  const target=safePath(config.workspace,'tasks',id,'state.json');await writeJson(target,state);
  await writeJson(safePath(config.workspace,'current.json'),{taskId:id,project:config.project});
  const current=['# Current task', '', `Task: ${id}`, `Goal: ${redact(state.goal)}`,
    `State: ${markdownLink('state.json',target)}`, `Snapshot: ${state.sourceHash}`, '', '## Next', '', ...state.next.map(value=>`- ${redact(value)}`), '',
    '## User wiring/configuration', '',...state.wiring.map(value=>`- ${redact(value)}`),''];
  await atomicWrite(safePath(config.workspace,'CURRENT.md'),current.join('\n'));
  await appendJournal(config.workspace,{event:'checkpoint',taskId:id,sourceHash:state.sourceHash});
  return {taskId:id,state:target,sourceHash:state.sourceHash,next:state.next};
}
export async function journalEntries(config: ToolkitConfig) {
  const target=safePath(config.workspace,'journal.jsonl');
  if(!await exists(target)) return {entries:[] as Record<string,any>[],incompleteTail:false};
  const text=await fs.readFile(target,'utf8');const lines=text.split('\n');const entries:Record<string,any>[]=[];let incompleteTail=false;
  for(let index=0;index<lines.length;index++) {
    if(!lines[index].trim()) continue;
    try {entries.push(JSON.parse(lines[index]));}
    catch {if(index===lines.length-1 && !text.endsWith('\n')) incompleteTail=true;else throw new Error(`Journal corruption at line ${index+1}`);}
  }
  return {entries,incompleteTail};
}
export async function resume(config: ToolkitConfig,id:string) {
  const state=await readTask(config,id);const graph=await scan(config);const journal=await journalEntries(config);
  const completed=new Set(journal.entries.filter(entry=>entry.event==='operation-finish').map(entry=>entry.operationId));
  const unfinished=journal.entries.filter(entry=>entry.event==='operation-start' && !completed.has(entry.operationId)).map(entry=>{
    const observed=journal.entries.filter(item=>item.event==='operation-observed' && item.operationId===entry.operationId).at(-1);
    return observed?{...entry,externalJobId:observed.externalJobId}:entry;
  });
  const result={state,sourceChanged:state.sourceHash!==graph.sourceHash,currentSourceHash:graph.sourceHash,
    unfinishedOperations:unfinished,incompleteJournalTail:journal.incompleteTail,
    instructions:['Inspect current files and prior test artifacts before repeating a command.','Do not replay unfinished operations automatically.','Codex conversation history is managed by Codex; this pack records toolkit progress.']};
  const target=safePath(config.workspace,'tasks',state.id,'RESUME.md');
  await atomicWrite(target,[`# Continue ${state.id}`,'',`Goal: ${redact(state.goal)}`,`Source changed since checkpoint: ${result.sourceChanged}`,'',
    '## Done','',...state.done.map(value=>`- ${redact(value)}`),'','## Next','',...state.next.map(value=>`- ${redact(value)}`),'',
    '## Decisions','',...state.decisions.map(value=>`- ${redact(value)}`),'','## User wiring','',...state.wiring.map(value=>`- ${redact(value)}`),'',
    `Unfinished operations: ${unfinished.length}`,`Incomplete journal tail: ${journal.incompleteTail}`,'',...result.instructions.map(value=>`- ${value}`),''].join('\n'));
  return {...result,resumeFile:target};
}
export async function remember(config:ToolkitConfig,text:string,sources:string[],supersedes?:string) {
  if(!text.trim()) throw new Error('Memory text cannot be empty');
  const record:MemoryRecord={id:randomUUID(),project:config.project,text:redact(text),sources:sources.map(redact),createdAt:now(),supersedes};
  await fs.mkdir(config.workspace,{recursive:true});
  await fs.appendFile(safePath(config.workspace,'memory.jsonl'),JSON.stringify(record)+'\n');return record;
}
export async function recall(config:ToolkitConfig,query:string,maxItems=3) {
  const target=safePath(config.workspace,'memory.jsonl');if(!await exists(target)) return [];
  const records=(await fs.readFile(target,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line) as MemoryRecord).filter(record=>record.project===config.project);
  const superseded=new Set(records.map(record=>record.supersedes).filter(Boolean));
  const terms=query.toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);
  return records.filter(record=>!superseded.has(record.id)).map(record=>({record,score:terms.reduce((sum,term)=>sum+(record.text.toLowerCase().includes(term)?1:0),0)}))
    .filter(item=>!terms.length || item.score>0).sort((a,b)=>b.score-a.score || b.record.createdAt.localeCompare(a.record.createdAt)).slice(0,maxItems).map(item=>item.record);
}
export async function handoff(config:ToolkitConfig,id:string) {
  const state=await readTask(config,id);const graph=await scan(config);let report:VerificationReport|undefined;
  if(state.lastRunId && await exists(safePath(config.workspace,'runs',state.lastRunId,'report.json')))
    report=await readJson<VerificationReport>(safePath(config.workspace,'runs',state.lastRunId,'report.json'));
  const fresh=Boolean(report && report.project===config.project && report.sourceHashAfter===graph.sourceHash && report.sourceHash===graph.sourceHash);
  const target=safePath(config.workspace,'tasks',state.id,'HANDOFF.md');
  const lines=[`# Handoff ${state.id}`,'',`Goal: ${redact(state.goal)}`,'','## Changes / completed work','',...state.done.map(value=>`- ${redact(value)}`),'',
    '## Verification','',`Result: ${report ? `${report.status} (${report.mode})` : 'not run'}`,`Evidence matches current source: ${fresh}`,''];
  for(const check of report?.checks ?? []) {
    lines.push(`- ${check.id}: ${check.status}; ${check.details}`);
    for(const evidence of check.evidence) lines.push(`  ${markdownLink('evidence',evidence)}`);
  }
  lines.push('', '## Remaining / user actions', '',...state.next.map(value=>`- ${redact(value)}`),...state.wiring.map(value=>`- ${redact(value)}`), '',
    '## Limits', '', ...(report?.omitted ?? ['No verification report is attached.']).map(value=>`- ${value}`),
    '- Editor checks do not establish mobile-device performance or native capture acceptance.','');
  await atomicWrite(target,lines.join('\n'));return {handoff:target,verification:report?.status ?? 'not-run',fresh};
}
