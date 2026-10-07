import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { decode } from '@toon-format/toon';
import { appendJournal, atomicWrite, exists, inside, safePath, writeJson } from './io.ts';
import { nativeEntry } from './native-tool.ts';
import { runProcess } from './process.ts';
import { readTask } from './state.ts';
import type { CheckResult, ToolkitConfig } from './types.ts';

const exec=promisify(execFile);
export const localSkip=['rebase','push','pr','ci'];
export function noMistakesEnvironment(config:ToolkitConfig) {return {NM_HOME:safePath(config.workspace,'no-mistakes'),NO_MISTAKES_TELEMETRY:'off',NO_MISTAKES_NO_UPDATE_CHECK:'1',NO_COLOR:'1'};}
export async function gatePrerequisites(config:ToolkitConfig) {
  const missing=[];let head='',branch='',gate='';
  if(!await exists(nativeEntry(config))) missing.push('Run setup --apply to install the pinned No-mistakes binary.');
  try {
    const git=async(...args:string[])=>(await exec('git',['--no-optional-locks','-C',config.project,...args],{windowsHide:true,timeout:5000})).stdout.trim();
    head=await git('rev-parse','HEAD');branch=await git('branch','--show-current');
    if(!branch) missing.push('No-mistakes needs a feature branch, not a detached HEAD.');
    if(['main','master'].includes(branch)) missing.push('Commit task changes on a feature branch before No-mistakes.');
    if(await git('status','--porcelain')) missing.push('No-mistakes validates committed changes; preserve unrelated work and commit only the intended change first.');
    try {await git('remote','get-url','origin');} catch {missing.push('No-mistakes needs an origin remote.');}
    try {gate=await git('remote','get-url','no-mistakes');} catch {missing.push('Initialize the project-scoped native gate as described in TESTING.md.');}
    if(gate && !inside(safePath(config.workspace,'no-mistakes'),path.resolve(config.project,gate))) missing.push('Existing No-mistakes gate belongs to another NM_HOME; reconcile it before running.');
  } catch {missing.push('No-mistakes needs a Git repository with committed task changes.');}
  return {ready:missing.length===0,head,branch,missing};
}
export async function nativeStatus(config:ToolkitConfig,command:'doctor'|'status') {
  const prerequisites=await gatePrerequisites(config);
  if(!await exists(nativeEntry(config))) return {status:'blocked',prerequisites};
  const log=safePath(config.workspace,'no-mistakes',`${command}.log`),stdoutFile=safePath(config.workspace,'no-mistakes',`${command}.toon`);
  const result=await runProcess(nativeEntry(config),command==='status'?['axi','status']:['doctor'],{cwd:config.project,timeoutMs:15000,log,stdoutFile,env:noMistakesEnvironment(config)});
  return {status:result.exitCode===0?'ready':'blocked',prerequisites,log,output:(await fs.readFile(stdoutFile,'utf8')).slice(0,10000)};
}
// A native exit 0 may mean a parked gate. Require bound terminal evidence.
export function validateGateResult(value:any,head:string,runId:string) {
  if(!value?.run || value.run.id!==runId || value.run.head_sha!==head) return 'blocked' as const;
  if(value.outcome==='failed' || value.run.status==='failed') return 'failed' as const;
  if(value.outcome!=='passed' || value.run.status!=='completed') return 'blocked' as const;
  const steps=value.run.steps;
  if(!Array.isArray(steps) || !['intent','review','test','document','lint'].every(name=>steps.some((s:any)=>s.step===name && s.status==='completed'))) return 'blocked' as const;
  return 'passed' as const;
}
export async function noMistakesCheck(config:ToolkitConfig,runDir:string,sourceHash:string,task?:string):Promise<CheckResult> {
  const started=Date.now(),id='no-mistakes',evidence:string[]=[];
  if(!config.testing.noMistakes?.enabled) return {id,status:'skipped',durationMs:0,details:'No-mistakes explicitly disabled in configuration; native review/test/doc/lint gate omitted.',evidence};
  const prerequisites=await gatePrerequisites(config);
  const preflight=path.join(runDir,'no-mistakes-preflight.json');await writeJson(preflight,prerequisites);evidence.push(preflight);
  if(!prerequisites.ready) return {id,status:'blocked',durationMs:Date.now()-started,details:prerequisites.missing.join(' '),evidence};
  let state;try {state=await readTask(config,task ?? 'current');} catch {return {id,status:'blocked',durationMs:Date.now()-started,details:'Record the exact user goal with task/checkpoint before full No-mistakes validation.',evidence};}
  const plan=path.join(runDir,'verification-plan.md');
  await atomicWrite(plan,[`# Verify ${state.id}`,'',`User goal: ${state.goal}`,`Source fingerprint: ${sourceHash}`,'',
    'Respect AGENTS.md and preserved project rules. Review/test/lint/document the committed change. Do not publish, push, create a PR or change Unity scenes/prefabs/settings.',
    'Use targeted native commands from project rules. Do not recursively run agentkit verify --mode full inside this gate.',
    'Report code/test artifacts with positive test counts, failures and missing evidence. Do not claim the working copy is validated if a fix exists only in the gate worktree.',''].join('\n'));
  const launchNonce=randomUUID(),log=path.join(runDir,'logs','no-mistakes.log'),stdoutFile=path.join(runDir,'no-mistakes.toon');
  const wait=Math.min(config.testing.noMistakes.timeoutMs,60000);
  const args=['axi','run','--intent',state.goal,'--verification-plan',plan,'--skip',localSkip.join(','),'--no-publish-intent','--launch-nonce',launchNonce,'--validation-generation',sourceHash,'--wait',`${wait}ms`];
  const operationId=`no-mistakes-${launchNonce}`;
  await appendJournal(config.workspace,{event:'operation-start',operationId,kind:id,head:prerequisites.head,sourceHash});
  const result=await runProcess(nativeEntry(config),args,{cwd:config.project,timeoutMs:wait+20000,log,stdoutFile,env:noMistakesEnvironment(config)});evidence.push(plan,log,stdoutFile);
  const text=await fs.readFile(stdoutFile,'utf8');
  const receiptText=text.split(/(?=^outcome:|^run:|^gate:|^error:)/m)[0];let receipt:any;
  try {receipt=(decode(receiptText) as any).launch_receipt;} catch { /* unknown output is blocked */ }
  let status:CheckResult['status']='blocked';
  if(receipt?.launch_nonce===launchNonce && receipt.validation_generation===sourceHash && receipt.submitted_head_sha===prerequisites.head && typeof receipt.run_id==='string') {
    await appendJournal(config.workspace,{event:'operation-observed',operationId,externalJobId:receipt.run_id});
    const terminalText=text.slice(text.indexOf('\noutcome:')+1);
    try {status=validateGateResult(decode(terminalText),prerequisites.head,receipt.run_id);} catch { /* parked/unparseable native output */ }
    if(['passed','failed'].includes(status)) await appendJournal(config.workspace,{event:'operation-finish',operationId,status,externalJobId:receipt.run_id});
  }
  return {id,status:result.timedOut?'blocked':status,durationMs:Date.now()-started,exitCode:result.exitCode,evidence,
    details:status==='passed'?'Native intent/review/test/document/lint passed for the submitted head. Publication/CI deliberately omitted.':status==='failed'?'No-mistakes reported a bound terminal failure.':`Native gate is unresolved or evidence is not bound to the submitted head; inspect ${stdoutFile} and no-mistakes status before retrying.`};
}
