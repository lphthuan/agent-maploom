#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.ts';
import { errorMessage, exists, readJson, safePath, withLock, writeJson } from './io.ts';
import { scan } from './scan.ts';
import { writeMap } from './map.ts';
import { codeContext } from './context.ts';
import { doctor } from './project.ts';
import { init } from './init.ts';
import { setup, graftBuild, toolEntrypoint, type ToolName } from './setup.ts';
import { checkpoint, handoff, recall, remember, resume } from './state.ts';
import { verify } from './verify.ts';
import { prepareTask } from './task.ts';
import { review, writeSetupPage } from './review.ts';
import { nativeStatus } from './no-mistakes.ts';
import { renderAxi } from './axi.ts';

const usage:Record<string,string>={
  init:'init [--attach] [--mode basic|full] — config, maps and project wrappers',
  doctor:'doctor [--offline] — project/runtime/readiness, optional live Unity MCP probe',
  setup:'setup [--plan|--apply] [--offline] [--no-attach] [--tool graft|memory|lavish|no-mistakes] — complete project setup; default apply',
  scan:'scan [--all] — hash allowed source, parse C#/TS/JS and record coverage',
  map:'map [--format md] — system/modules/context index',
  context:'context "query" [--in relative/path] — bounded source and local decisions',
  task:'task --task id --goal "exact user goal" — durable change brief and candidate locations',
  verify:'verify --mode basic|full [--runner mcp|batch|commands] [--test name-or-file] [--changed file] [--platform EditMode|PlayMode] [--task current]',
  checkpoint:'checkpoint --task id --goal "goal" [--done item] [--next item] [--decision item] [--wiring item] — lists replace previous lists',
  resume:'resume [--task current] — source drift and unresolved operations',
  handoff:'handoff [--task current] — changes, test artifacts and freshness',
  memory:'memory add "lesson" --source path | memory recall "query" | memory serve',
  graft:'graft build — pinned structural cache without LLM/hooks',
  review:'review open|poll|reply|stop|playbook [message-or-playbook] [--file workspace.html] [--no-open]',
  'no-mistakes':'no-mistakes doctor|status — native full-mode gate readiness/progress; start through verify --mode full'
};
const flags:Record<string,string[]>={init:['attach','mode'],doctor:['offline'],setup:['plan','apply','offline','no-attach','tool'],scan:['all'],map:['format'],context:['in'],
  task:['task','goal'],verify:['mode','runner','test','changed','platform','task'],checkpoint:['task','goal','done','next','decision','wiring'],resume:['task'],handoff:['task'],
  memory:['source','supersedes'],graft:[],review:['file','no-open'],'no-mistakes':[]};
const help=`AgentMaploom 0.2.0 — local setup/context for AI coding agents\n\n${Object.values(usage).join('\n')}\n\nCommon: --project path --workspace path --config file --json --full --help\nNo arguments: local status. Default: bounded AXI-style TOON; --json: full structured result.\nExit: 0 success, 1 failed/stale, 2 invalid request or blocked verification.\n`;
async function main() {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{
    project:{type:'string'},workspace:{type:'string'},config:{type:'string'},json:{type:'boolean'},full:{type:'boolean'},help:{type:'boolean',short:'h'},
    attach:{type:'boolean'},'no-attach':{type:'boolean'},offline:{type:'boolean'},plan:{type:'boolean'},apply:{type:'boolean'},all:{type:'boolean'},format:{type:'string'},
    mode:{type:'string'},runner:{type:'string'},test:{type:'string',multiple:true},changed:{type:'string',multiple:true},platform:{type:'string',multiple:true},
    task:{type:'string'},goal:{type:'string'},done:{type:'string',multiple:true},next:{type:'string',multiple:true},decision:{type:'string',multiple:true},wiring:{type:'string',multiple:true},
    source:{type:'string',multiple:true},supersedes:{type:'string'},tool:{type:'string',multiple:true},in:{type:'string'},file:{type:'string'},'no-open':{type:'boolean'}
  }});
  const [command,...args]=positionals;
  if(values.help) {console.log(command?(usage[command] ?? `Unknown command ${command}`)+'\nCommon: --project --workspace --config --json --full':help);if(command && !usage[command]) process.exitCode=2;return;}
  if(command && !usage[command]) throw new Error(`Unknown command: ${command}`);
  const allowed=new Set(['project','workspace','config','json','full','help',...(flags[command] ?? [])]);
  for(const name of Object.keys(values)) if(!allowed.has(name)) throw new Error(`--${name} is not valid for ${command ?? 'status'}`);
  const saved=path.resolve(values.project ?? process.cwd(),'.agentkit','agentkit.config.json');
  const config=await loadConfig({...values,config:values.config ?? (await exists(saved)?saved:undefined)});
  if(command==='init' && values.mode) {
    if(!['basic','full'].includes(values.mode)) throw new Error('Mode must be basic or full');config.testing.defaultMode=values.mode as 'basic'|'full';
  }
  if(command==='memory' && args[0]==='serve') {
    const entry=toolEntrypoint(config,'memory');if(!await exists(entry)) throw new Error('Install memory helper with setup --apply --tool memory');
    const child=spawn(process.execPath,[entry],{env:{...process.env,MEMORY_FILE_PATH:path.join(config.workspace,'memory-graph.jsonl')},stdio:'inherit',windowsHide:true});
    child.on('error',error=>{console.error(errorMessage(error));process.exitCode=2;});child.on('exit',code=>{process.exitCode=code ?? 2;});return;
  }
  const execute=async()=> {
    switch(command) {
      case undefined: {
        const graphPath=safePath(config.workspace,'graph.json'),graph=await exists(graphPath)?await readJson<any>(graphPath):undefined;
        const helpers=await Promise.all(['graft','memory','lavish','no-mistakes'].map(async name=>({tool:name,installed:await exists(toolEntrypoint(config,name as ToolName))})));
        const current=safePath(config.workspace,'current.json');
        return {project:config.project,profile:config.profile,setup:await exists(safePath(config.workspace,'agentkit.config.json'))?'configured':'needed',agents:await exists(path.join(config.project,'AGENTS.md')),
          snapshot:graph?{generatedAt:graph.generatedAt,sourceHash:graph.sourceHash,counts:graph.counts}:null,current:await exists(current)?await readJson(current):null,helpers,
          help:['setup --apply','context "user goal"','task --task feature-1 --goal "user goal"','resume --task current']};
      }
      case 'init': return init(config,Boolean(values.attach));
      case 'doctor': return doctor(config,!values.offline);
      case 'setup': {
        if(values.apply && values.plan) throw new Error('Choose --plan or --apply');
        if(values.plan || values.tool?.length) return setup(config,!values.plan,values.tool as ToolName[]|undefined,Boolean(values.offline));
        const prepared=await init(config,!values['no-attach']);
        const helpers=await setup(config,true,undefined,Boolean(values.offline));
        const graft=helpers.status==='ready'?await graftBuild(config):{status:'skipped'};
        const result={status:helpers.status==='failed'||graft.status==='failed'?'failed':'ready',...prepared,helpers,graft,
          help:['task --task feature-1 --goal "user goal"','context "question"','review open','verify --mode basic --test test-name-or-file']};
        const page=await writeSetupPage(config,result);await writeJson(safePath(config.workspace,'setup-report.json'),{...result,page});return {...result,page};
      }
      case 'scan': {const graph=await scan(config);return {sourceHash:graph.sourceHash,counts:graph.counts,changedFiles:graph.changedFiles,graph:safePath(config.workspace,'graph.json'),coverage:safePath(config.workspace,'coverage.json')};}
      case 'map': {if(values.format && values.format!=='md') throw new Error('Only --format md is supported');return writeMap(config,await scan(config));}
      case 'context': return codeContext(config,args.join(' '),values.in);
      case 'task': return prepareTask(config,values.goal ?? args.join(' '),values.task);
      case 'checkpoint': return checkpoint(config,{id:values.task ?? 'current',goal:values.goal,done:values.done,next:values.next,decisions:values.decision,wiring:values.wiring});
      case 'resume': return resume(config,values.task ?? 'current');
      case 'handoff': return handoff(config,values.task ?? 'current');
      case 'memory': {
        if(args[0]==='add') return remember(config,args.slice(1).join(' '),values.source ?? [],values.supersedes);
        if(args[0]==='recall') return {memories:await recall(config,args.slice(1).join(' '),3)};
        throw new Error('memory requires add, recall, or serve');
      }
      case 'graft': {if(args[0]!=='build') throw new Error('Only graft build is implemented');return graftBuild(config);}
      case 'review': return review(config,args[0] ?? 'open',values.file,args.slice(1).join(' '),Boolean(values['no-open']));
      case 'no-mistakes': {if(!['status','doctor'].includes(args[0])) throw new Error('Use no-mistakes status|doctor; run the gate only through verify --mode full');return nativeStatus(config,args[0] as 'status'|'doctor');}
      case 'verify': {
        if(values.mode && !['basic','full'].includes(values.mode)) throw new Error('Mode must be basic or full');
        if(values.runner && !['mcp','batch','commands'].includes(values.runner)) throw new Error('Runner must be mcp, batch, or commands');
        return verify(config,{mode:values.mode as 'basic'|'full'|undefined,runner:values.runner as 'mcp'|'batch'|'commands'|undefined,tests:values.test,changed:values.changed,platforms:values.platform,task:values.task});
      }
    }
  };
  // Long-polling a review must not hold the project writer lock; edits remain possible.
  const output=command==='review'||command==='no-mistakes'?await execute():await withLock(config.workspace,execute);
  const result=output as Record<string,unknown>;
  if(command==='context' && !values.json) console.log(result.text);
  else console.log(renderAxi(result,Boolean(values.json),Boolean(values.full)));
  if(['failed','stale'].includes(String(result.status))) process.exitCode=1;if(result.status==='blocked') process.exitCode=2;
}
main().catch(error=>{console.error(renderAxi({status:'error',error:{code:'INVALID_OR_BLOCKED',message:errorMessage(error)},help:['agent-maploom --help','agent-maploom <command> --help']},process.argv.includes('--json')));process.exitCode=2;});
