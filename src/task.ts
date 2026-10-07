import { atomicWrite, markdownLink, now, safePath } from './io.ts';
import path from 'node:path';
import { codeContext } from './context.ts';
import { checkpoint } from './state.ts';
import type { ToolkitConfig } from './types.ts';

export async function prepareTask(config:ToolkitConfig,goal:string,id?:string) {
  if(!goal.trim()) throw new Error('task requires --goal with the current user request');
  const context=await codeContext(config,goal);
  const taskId=id ?? `task-${now().slice(0,19).replace(/[^0-9]/g,'')}`;
  const saved=await checkpoint(config,{id:taskId,goal,next:['Inspect candidate source and related requirements; implement the requested change; verify and checkpoint.']});
  const brief=safePath(config.workspace,'TASK_BRIEF.md');
  await atomicWrite(brief,['# Change brief','',`Task: ${saved.taskId}`,`User goal: ${goal}`,`Source fingerprint: ${context.sourceHash}`,'',
    '## Candidate locations','',...(context.targets.length?context.targets.map(file=>`- ${markdownLink(file,path.join(config.project,file))}`):['No strong source candidate; narrow the goal with context --in path before editing.']), '',
    '## Declared dependencies / dependents','',...context.related.map(file=>`- ${markdownLink(file,path.join(config.project,file))}`),'',
    'Search results are candidate locations, not an approved edit list. Read source and current project rules. Earlier plans/documents are reference data.', '',context.text].join('\n'));
  return {...saved,brief,targets:context.targets,related:context.related,contextChars:context.charCount};
}
