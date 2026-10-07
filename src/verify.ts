import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendJournal, atomicWrite, errorMessage, exists, hash, markdownLink, now, readJson, safePath, slash, writeJson } from './io.ts';
import { connectionError, HttpMcpClient, object } from './mcp.ts';
import { editorExecutable, gitChanged } from './project.ts';
import { runProcess } from './process.ts';
import { prepareBatchProject } from './batch-project.ts';
import { scan } from './scan.ts';
import { readTask } from './state.ts';
import type { CheckResult, ProjectGraph, ToolkitConfig, VerificationReport } from './types.ts';
import { detectProfile } from './profile.ts';
import { noMistakesCheck } from './no-mistakes.ts';

export function parseNUnitXml(xml:string) {
  const root=/<test-run\b([^>]*)>/i.exec(xml);
  if(!root) throw new Error('No NUnit test-run element');
  const attributes=Object.fromEntries([...root[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(match=>[match[1],match[2]]));
  const passed=Number(attributes.passed ?? 0),failed=Number(attributes.failed ?? 0);
  const executed=passed+failed+Number(attributes.inconclusive ?? 0);
  if(!Number.isFinite(executed) || !Number.isFinite(failed)) throw new Error('Invalid test counts');
  return {executed,passed,failed,status:executed>0 && failed===0 && attributes.result==='Passed' ? 'passed' as const : 'failed' as const};
}
export function parseNodeTap(text:string) {
  const count=(name:string)=>Number([...text.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`,'gm'))].at(-1)?.[1] ?? NaN);
  const passed=count('pass'),failed=count('fail'),cancelled=count('cancelled');
  const executed=passed+failed;
  return {executed,passed,failed,status:Number.isFinite(executed)&&executed>0&&failed===0&&cancelled===0?'passed' as const:'failed' as const};
}
export function selectNodeTests(graph:ProjectGraph,mode:'basic'|'full',tests?:string[],changed:string[]=[]) {
  const all=graph.files.filter(f=>f.kind==='typescript'&&f.status==='parsed'&&/\.(?:test|spec)\.(?:ts|js|mjs|mts|tsx)$/.test(f.path)).map(f=>f.path);
  if(tests?.length) {
    const normalized=tests.map(s=>slash(s).replace(/^\.\//,''));
    if(normalized.some(s=>!all.includes(s))) throw new Error('Node --test expects inventoried test file paths relative to the project, not test names/globs');
    return normalized;
  }
  if(mode==='full') return all;
  const impacted=new Set(changed.map(s=>slash(s).replace(/^\.\//,'')));
  const queue=[...impacted];
  while(queue.length) {
    const target=queue.shift()!;
    for(const edge of graph.edges.filter(e=>e.kind==='import'&&e.to===target)) if(!impacted.has(edge.from)){impacted.add(edge.from);queue.push(edge.from);}
  }
  return all.filter(file=>impacted.has(file));
}
const payload=(value:unknown)=>object(object(value).data ?? value);
export function inferTests(graph:ProjectGraph,changed:string[]) {
  const names=new Set(changed.flatMap(file=>graph.files.find(record=>record.path===slash(file))?.symbols?.filter(symbol=>!['method','constructor'].includes(symbol.kind)).map(symbol=>symbol.name) ?? []));
  return graph.files.filter(file=>file.testNames?.length && (changed.includes(file.path) || file.symbols?.some(symbol=>
    [...names].some(name=>symbol.name.includes(name))))).flatMap(file=>file.testNames ?? []);
}
export async function selectTests(config:ToolkitConfig,graph:ProjectGraph,input:{tests?:string[];changed?:string[];mode:'basic'|'full'}) {
  if(input.tests?.length) return {tests:input.tests,reason:'explicit test filter'};
  if(input.mode==='full') return {tests:[] as string[],reason:'full mode: all tests in configured platforms'};
  const changed=input.changed ?? await gitChanged(config.project) ?? [];
  const inferred=inferTests(graph,changed);
  if(inferred.length) return {tests:inferred,reason:'test names inferred from changed type/test file names; review filter'};
  return {tests:[] as string[],reason:'no confident test filter; provide --test or --changed'};
}
async function batchTests(config:ToolkitConfig,platform:string,tests:string[],runDir:string,graph:ProjectGraph):Promise<CheckResult> {
  const started=Date.now();const id=`unity-${platform}`;const editor=await editorExecutable(config);
  if(!editor) return {id,status:'blocked',durationMs:0,details:'Unity Editor not found; configure unity.editorPath.',evidence:[]};
  if(platform==='PlayMode') {
    const interactive=[];
    for(const file of graph.files.filter(file=>file.testNames?.length && (tests.length===0 || file.testNames.some(name=>tests.some(filter=>name===filter || name.startsWith(filter+'.')))))) {
      const source=await fs.readFile(path.join(config.project,file.path),'utf8');
      if(/\bnew\s+(?:UnityEngine\.)?WaitForEndOfFrame\s*\(/.test(source)) interactive.push(file.path);
    }
    if(interactive.length) {
      const evidence=path.join(runDir,'PlayMode-interactive-required.json');
      await writeJson(evidence,{files:interactive,reason:'WaitForEndOfFrame does not run in Editor batch mode.',
        action:'Run these tests through MCP in a normal Editor with the Game view active, or choose an explicit compatible test filter.',
        source:'https://docs.unity3d.com/6000.3/Documentation/ScriptReference/WaitForEndOfFrame.html'});
      return {id,status:'blocked',durationMs:Date.now()-started,details:`Tests require a normal Editor/MCP (WaitForEndOfFrame): ${interactive.join(', ')}`,evidence:[evidence]};
    }
  }
  const snapshot=await prepareBatchProject(config,graph,runDir);
  const xml=path.join(runDir,`${platform}.xml`),unityLog=path.join(runDir,'logs',`${platform}-unity.log`),processLog=path.join(runDir,'logs',`${platform}-process.log`);
  const args=['-batchmode','-projectPath',snapshot.project,'-runTests','-testPlatform',platform,'-testResults',xml,'-logFile',unityLog];
  if(tests.length) args.push('-testFilter',tests.join(';'));
  const result=await runProcess(editor,args,{cwd:snapshot.project,timeoutMs:config.testing.timeoutMs,log:processLog});
  const evidence=[snapshot.evidence,processLog,...await exists(unityLog)?[unityLog]:[],...await exists(xml)?[xml]:[]];
  const provenance=await readJson<{files:{path:string;sha256:string}[]}>(snapshot.evidence);
  const modifiedInputs:string[]=[];
  for(const file of provenance.files.filter(file=>/\.(cs|asmdef|asmref)$/.test(file.path) || file.path==='Packages/manifest.json')) {
    const copy=path.join(snapshot.project,file.path);
    if(!await exists(copy) || hash(await fs.readFile(copy))!==file.sha256) modifiedInputs.push(file.path);
  }
  if(modifiedInputs.length) return {id,status:'failed',durationMs:Date.now()-started,details:`Unity changed copied compile inputs: ${modifiedInputs.join(', ')}`,exitCode:result.exitCode,evidence};
  if(result.timedOut || !await exists(xml)) return {id,status:'failed',durationMs:Date.now()-started,details:result.timedOut?'Unity timed out; inspect logs.':'Unity produced no NUnit XML; compile/startup may have failed.',exitCode:result.exitCode,evidence};
  const parsed=parseNUnitXml(await fs.readFile(xml,'utf8'));
  return {id,status:result.exitCode===0?parsed.status:'failed',durationMs:Date.now()-started,exitCode:result.exitCode,
    executedTests:parsed.executed,details:`${parsed.executed} executed; ${parsed.passed} passed, ${parsed.failed} failed.`,evidence};
}
function schemaArgs(properties:Record<string,unknown>,values:Record<string,unknown>) {
  const args:Record<string,unknown>={};
  for(const [key,value] of Object.entries(values)) {
    if(value===undefined) continue;
    const camel=key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
    if(key in properties) args[key]=value;else if(camel in properties) args[camel]=value;
  }
  return args;
}
export function editorBusy(state:Record<string,any>) {
  const compilation=object(state.compilation),assets=object(state.assets),play=object(object(state.editor).play_mode);
  return Boolean(state.is_compiling || state.is_domain_reload_pending || compilation.is_compiling || compilation.is_domain_reload_pending ||
    assets.is_updating || object(assets.refresh).is_refresh_in_progress || object(state.tests).is_running || play.is_changing || state.ready_for_tools===false);
}
async function mcpTests(config:ToolkitConfig,platform:string,tests:string[],runDir:string):Promise<CheckResult> {
  const started=Date.now();const id=`unity-${platform}`;const client=new HttpMcpClient(config.unity.mcpUrl,config.unity.timeoutMs);
  const artifact=path.join(runDir,`${platform}-mcp.json`);const evidence:string[]=[];
  try {
    const resources=await client.resources();
    if(config.unity.instance) {
      const tools=await client.tools();const select=tools.find(tool=>tool.name==='set_active_instance');
      if(!select) throw new Error('set_active_instance is not exposed');
      await client.tool(select.name,schemaArgs(object(select.inputSchema.properties),{instance:config.unity.instance}));
    }
    const projectResource=resources.find(resource=>resource.uri.endsWith('/project/info'));
    const stateResource=resources.find(resource=>resource.uri.endsWith('/editor/state'));
    if(!projectResource || !stateResource) throw new Error('Unity project/info and editor/state resources must be exposed');
    const info=payload(await client.resource(projectResource.uri));
    const projectPath=info.project_root ?? info.projectRoot ?? info.project_path ?? info.projectPath ?? info.path;
    const normalize=(value:string)=>slash(path.resolve(value)).toLowerCase();
    if(typeof projectPath!=='string' || normalize(projectPath)!==normalize(config.project)) throw new Error('Connected Unity project could not be matched to config.project; tests were not started');
    const deadline=Date.now()+config.testing.timeoutMs;
    let state=payload(await client.resource(stateResource.uri));
    while(editorBusy(state)) {
      if(Date.now()>deadline) throw new Error('Editor did not become ready before timeout');
      await new Promise(resolve=>setTimeout(resolve,500));state=payload(await client.resource(stateResource.uri));
    }
    const tools=await client.tools();const start=tools.find(tool=>tool.name==='run_tests'),poll=tools.find(tool=>tool.name==='get_test_job');
    if(!start || !poll) throw new Error('Unity testing tools are disabled/not exposed');
    const consoleTool=tools.find(tool=>tool.name==='read_console');
    if(consoleTool) {
      const consoleResult=await client.tool(consoleTool.name,schemaArgs(object(consoleTool.inputSchema.properties),{action:'get',types:['error'],count:20,include_stacktrace:true}));
      const consolePath=path.join(runDir,'logs',`${platform}-console-before.json`);await writeJson(consolePath,consoleResult);evidence.push(consolePath);
      const entries=payload(consoleResult).entries ?? payload(consoleResult).messages;
      if(Array.isArray(entries) && entries.some(entry=>/\berror\s+CS\d+/.test(JSON.stringify(entry)))) throw new Error('Console contains C# compile errors');
    }
    const jobOperationId=`unity-tests-${randomUUID()}`;
    await appendJournal(config.workspace,{event:'operation-start',operationId:jobOperationId,kind:'unity-tests',platform,project:config.project,tests});
    const startResult=payload(await client.tool(start.name,schemaArgs(object(start.inputSchema.properties),{mode:platform,test_names:tests.length?tests:undefined,include_details:true,include_failed_tests:true})));
    const jobId=startResult.job_id ?? startResult.jobId;
    if(typeof jobId!=='string') throw new Error('run_tests returned no job id');
    await appendJournal(config.workspace,{event:'operation-observed',operationId:jobOperationId,externalJobId:jobId});
    let job:Record<string,any>;
    do {
      if(Date.now()>deadline) throw new Error(`Unity job ${jobId} is still unresolved; inspect before retrying`);
      job=payload(await client.tool(poll.name,schemaArgs(object(poll.inputSchema.properties),{job_id:jobId,include_details:true,include_failed_tests:true})));
      await writeJson(artifact,job);
      if(['running','pending','queued'].includes(job.status)) await new Promise(resolve=>setTimeout(resolve,1000));
      else break;
    } while(true);
    evidence.push(artifact);
    await appendJournal(config.workspace,{event:'operation-finish',operationId:jobOperationId,externalJobId:jobId,status:job.status});
    const summary=object(object(job.result).summary ?? job.summary);
    const passed=Number(summary.passed ?? summary.passedCount ?? 0),failed=Number(summary.failed ?? summary.failedCount ?? 0);
    const executed=passed+failed+Number(summary.inconclusive ?? 0);
    return {id,status:job.status==='succeeded' && Number.isFinite(executed) && executed>0 && failed===0 ? 'passed':'failed',durationMs:Date.now()-started,
      executedTests:executed,details:`job ${jobId}: ${job.status}; ${executed} executed, ${failed} failed.`,evidence};
  } catch(error) {return {id,status:'blocked',durationMs:Date.now()-started,details:connectionError(error),evidence};}
  finally {await client.close();}
}
export async function verify(config:ToolkitConfig,input:{mode?:'basic'|'full';runner?:'mcp'|'batch'|'commands';tests?:string[];changed?:string[];task?:string;platforms?:string[]}) {
  const mode=input.mode ?? config.testing.defaultMode,runner=input.runner ?? config.testing.runner;
  const profile=await detectProfile(config);
  const platforms=input.platforms ?? config.testing.modes[mode].platforms;
  if(platforms.some(platform=>!['EditMode','PlayMode'].includes(platform))) throw new Error('Test platform must be EditMode or PlayMode');
  const before=await scan(config);const selection=await selectTests(config,before,{...input,mode});
  const runId=`${now().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;const runDir=safePath(config.workspace,'runs',runId);
  await fs.mkdir(path.join(runDir,'logs'),{recursive:true});const operationId=randomUUID();
  let selectedTask:string|undefined;
  if(input.task) selectedTask=(await readTask(config,input.task)).id;
  await appendJournal(config.workspace,{event:'operation-start',operationId,kind:'verify',runId,taskId:selectedTask,mode,runner,sourceHash:before.sourceHash});
  const checks:CheckResult[]=[];const startedAt=now();
  if(before.counts.errors>0) checks.push({id:'source-snapshot',status:'blocked',durationMs:0,details:`${before.counts.errors} files could not be read/parsed; inspect coverage.json.`,evidence:[safePath(config.workspace,'coverage.json')]});
  const commands=config.testing.modes[mode].commands;
  if(runner==='commands') {
    if(!commands.length) checks.push({id:'commands',status:'blocked',durationMs:0,details:'No command recipes configured for this mode.',evidence:[]});
    for(const recipe of commands) {
      try {
        if(!/^[A-Za-z0-9._-]+$/.test(recipe.id)) throw new Error('Invalid command id');
        const log=path.join(runDir,'logs',`${recipe.id}.log`);
        let selectedFiles:string[]=[];
        if(recipe.args.includes('{tests}')) {
          selectedFiles=selectNodeTests(before,mode,input.tests,input.changed ?? await gitChanged(config.project) ?? []);
          if(!selectedFiles.length) {checks.push({id:recipe.id,status:'blocked',durationMs:0,details:'No confident native test selection. Use --test tests/file.test.ts or --changed src/file.ts.',evidence:[]});continue;}
        }
        const args=recipe.args.flatMap(value=>value==='{tests}'?selectedFiles:[value.replaceAll('{runDir}',runDir).replaceAll('{project}',config.project)]);
        const result=await runProcess(recipe.executable,args,{cwd:recipe.cwd?path.resolve(config.project,recipe.cwd):config.project,timeoutMs:recipe.timeoutMs??config.testing.timeoutMs,log,env:{NODE_TEST_CONTEXT:undefined}});
        let status:CheckResult['status']=result.exitCode===0 && !result.timedOut?'passed':'failed';let executedTests:number|undefined;
        const evidence=[log];let details=`Exit ${result.exitCode}${result.timedOut?'; timed out':''}`;
        if(recipe.testResults) {
          const xml=path.resolve(runDir,recipe.testResults.replaceAll('{runDir}',runDir));
          if(!await exists(xml)) {status='failed';details+='; missing test XML';}
          else {const parsed=parseNUnitXml(await fs.readFile(xml,'utf8'));executedTests=parsed.executed;status=status==='passed'?parsed.status:status;evidence.push(xml);details+=`; ${parsed.executed} tests executed`;}
        }
        if(recipe.resultFormat==='node-tap') {
          const parsed=parseNodeTap(await fs.readFile(log,'utf8'));executedTests=parsed.executed;
          status=status==='passed'?parsed.status:status;details+=`; ${parsed.executed} tests executed, ${parsed.failed} failed`;
        }
        checks.push({id:recipe.id,status,exitCode:result.exitCode,durationMs:result.durationMs,details,executedTests,evidence});
      } catch(error) {checks.push({id:recipe.id,status:'blocked',durationMs:0,details:errorMessage(error),evidence:[]});}
    }
  } else if(mode==='basic' && !selection.tests.length) checks.push({id:'test-selection',status:'blocked',durationMs:0,details:selection.reason,evidence:[]});
  else {
    if(!platforms.length) checks.push({id:'test-platform',status:'blocked',durationMs:0,details:'No test platforms configured.',evidence:[]});
    for(const platform of platforms) {
      if(!['EditMode','PlayMode'].includes(platform)) throw new Error('Test platform must be EditMode or PlayMode');
      try {checks.push(await (runner==='mcp'?mcpTests(config,platform,selection.tests,runDir):batchTests(config,platform,selection.tests,runDir,before)));}
      catch(error) {checks.push({id:`unity-${platform}`,status:'failed',durationMs:0,details:errorMessage(error),evidence:[]});}
    }
  }
  if(mode==='full') {
    if(checks.every(check=>check.status==='passed')) {
      try {checks.push(await noMistakesCheck(config,runDir,before.sourceHash,selectedTask));}
      catch(error) {checks.push({id:'no-mistakes',status:'blocked',durationMs:0,details:errorMessage(error),evidence:[]});}
    } else checks.push({id:'no-mistakes',status:'skipped',durationMs:0,details:'Resolve failed/blocked project checks before launching the native gate.',evidence:[]});
  }
  const after=await scan(config);
  const status=before.sourceHash!==after.sourceHash?'stale':checks.some(check=>check.status==='failed')?'failed':checks.some(check=>check.status==='blocked')?'blocked':'passed';
  const report:VerificationReport={schemaVersion:1,runId,project:config.project,taskId:selectedTask,mode,startedAt,finishedAt:now(),sourceHash:before.sourceHash,sourceHashAfter:after.sourceHash,status,checks,
    omitted:[...(mode==='basic'?['Unselected tests/regression suites.','No-mistakes native gate (full mode only).']:['No-mistakes publication/CI steps (local verification only).',...!config.testing.noMistakes?.enabled?['No-mistakes disabled explicitly in configuration.']:[]]),
      ...profile==='unity'?['Mobile device/build/native capture acceptance unless configured with actual evidence.']:[]],
    instructions:[selection.reason,...profile==='unity'?['Scene/prefab/settings edits remain user-managed.','A positive executed-test count and result artifact are required for Unity test success.']:['Native Node tests require positive executed-test counts in saved TAP artifacts.']]};
  const reportPath=path.join(runDir,'report.json');await writeJson(reportPath,report);
  await writeJson(safePath(config.workspace,'last-run.json'),{runId,taskId:selectedTask,project:config.project});
  if(selectedTask) {const state=await readTask(config,selectedTask);state.lastRunId=runId;await writeJson(safePath(config.workspace,'tasks',selectedTask,'state.json'),state);}
  await atomicWrite(path.join(runDir,'HANDOFF.md'),[`# Verification ${runId}`,'',`Mode: ${mode}`,`Result: ${status}`,'',
    ...checks.map(check=>`- ${check.id}: ${check.status}. ${check.details}`),'',...checks.flatMap(check=>check.evidence.map(file=>markdownLink('evidence',file))), '', 'Not checked:',...report.omitted.map(value=>`- ${value}`),''].join('\n'));
  await appendJournal(config.workspace,{event:'operation-finish',operationId,runId,status});
  return {runId,status,mode,report:reportPath,checks:checks.map(({id,status,details,executedTests})=>({id,status,details,executedTests})),omitted:report.omitted};
}
