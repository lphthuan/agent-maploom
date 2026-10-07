import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.ts';
import { defaults, loadConfig } from '../src/config.ts';
import { parseTypeScript } from '../src/ts-source.ts';
import { scan } from '../src/scan.ts';
import { init } from '../src/init.ts';
import { prepareTask } from '../src/task.ts';
import { parseNodeTap, selectNodeTests, verify } from '../src/verify.ts';
import { validateGateResult, localSkip } from '../src/no-mistakes.ts';
import { verifyArchive } from '../src/native-tool.ts';
import { renderAxi } from '../src/axi.ts';
import { codeContext } from '../src/context.ts';

const exec=promisify(execFile);
async function nodeFixture() {
  const f=await fixture(),project=path.join(f.directory,'Node Việt Project');
  const put=async(file:string,text:string)=>{const target=path.join(project,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);};
  await put('package.json',JSON.stringify({type:'module',scripts:{test:'node --test tests/*.test.ts'}}));
  await put('src/core.ts','export function damage(hp:number,amount:number) { return hp-amount; }');
  await put('src/service.ts',"import { damage } from './core.ts'; export const applyDamage=(hp:number)=>damage(hp,1);");
  await put('tests/combat.test.ts',"import test from 'node:test'; import assert from 'node:assert/strict'; import {applyDamage} from '../src/service.ts'; test('damage changes health',()=>assert.equal(applyDamage(5),4));");
  await put('tests/other.test.ts',"import test from 'node:test'; test('unrelated',()=>{});");
  const config=defaults(project,path.join(f.directory,'node-state'));config.profile='node';config.testing.runner='commands';config.testing.noMistakes={enabled:true,timeoutMs:10000};
  config.testing.modes.basic={platforms:[],commands:[{id:'node-tests',executable:process.execPath,args:['--test','--test-reporter=tap','{tests}'],resultFormat:'node-tap'}]};
  config.testing.modes.full=config.testing.modes.basic;
  return {...f,project,put,config};
}

test('TS parser resolves exported functions, nested methods, tests and syntax diagnostics',()=>{
  const parsed=parseTypeScript("import {x} from './x.js'; export class Store { save() {} } export const read=()=>x;",'src/a.ts');
  assert.equal(parsed.parseErrors,0);assert(parsed.symbols.some(s=>s.name==='save'&&s.namespace==='Store'));assert(parsed.symbols.some(s=>s.name==='read'));
  assert.equal(parsed.imports[0].specifier,'./x.js');assert(parseTypeScript('export function broken( {','bad.ts').parseErrors>0);
});

test('node project scans without Unity marker and transitive import impact selects relevant tests',async()=>{
  const f=await nodeFixture();try {
    const graph=await scan(f.config);assert.equal(graph.counts.parsedTypeScript,4);assert.equal(graph.counts.errors,0);
    assert(graph.edges.some(e=>e.kind==='import'&&e.to==='src/core.ts'));
    assert.deepEqual(selectNodeTests(graph,'basic',undefined,['src/core.ts']),['tests/combat.test.ts']);
    assert.equal(selectNodeTests(graph,'full').length,2);
    assert.throws(()=>selectNodeTests(graph,'basic',['../escape.test.ts']));
  }finally{await f.dispose();}
});

test('generic AGENTS map preserves rules/VS Code tasks across repeated attachment and task maps code',async()=>{
  const f=await nodeFixture();try {
    const original='# Rules\nAlways typecheck before handoff.\n';await f.put('AGENTS.md',original);
    await f.put('.vscode/tasks.json',JSON.stringify({version:'2.0.0',tasks:[{label:'User task',type:'process',command:'example'},{label:'AgentKit: map',type:'process',command:'old-location'}]}));
    await init(f.config,true);await init(f.config,true);
    assert.equal(await fs.readFile(path.join(f.project,'Docs/Agent/PROJECT_RULES.md'),'utf8'),original);
    const map=await fs.readFile(path.join(f.project,'AGENTS.md'),'utf8');assert(map.startsWith('# Project agent map'));assert(!map.includes('Codex edits'));assert(map.split('\n').length<=15);
    const tasks=JSON.parse(await fs.readFile(path.join(f.project,'.vscode/tasks.json'),'utf8'));assert.equal(tasks.tasks.filter((t:any)=>t.label==='User task').length,1);assert.equal(tasks.tasks.length,6);assert(!tasks.tasks.some((t:any)=>t.label.startsWith('AgentKit:')));assert.equal(tasks.tasks.filter((t:any)=>t.label.startsWith('AgentMaploom:')).length,5);
    const brief=await prepareTask(f.config,'applyDamage damage','combat');assert(brief.targets.includes('src/service.ts'));assert([...brief.targets,...brief.related].includes('src/core.ts'));
    const commands=await fs.readFile(path.join(f.config.workspace,'docs/COMMANDS.md'),'utf8');assert(!commands.includes('<toolkit>'));assert(commands.includes('agentkit.mjs'));
  }finally{await f.dispose();}
});

test('JSONC tasks and old roadmap stay intact; current requirements are retrievable before obsolete plans',async()=>{
  const f=await nodeFixture();try {
    const tasks='// user tasks\n{"version":"2.0.0","tasks":[]}';await f.put('.vscode/tasks.json',tasks);
    await f.put('docs/CURRENT_SCOPE.md','# Current scope\n<!-- agentkit: status=current -->\nQuota account routing is deferred. Focus on project setup.');
    await f.put('docs/PHASE2_OPTIONS.md','# Old plan\nQuota account routing must be implemented.');
    await init(f.config,true);assert.equal(await fs.readFile(path.join(f.project,'.vscode/tasks.json'),'utf8'),tasks);
    const context=await codeContext(f.config,'quota routing');assert.equal(context.locations[0].file,'docs/CURRENT_SCOPE.md');
    const index=await fs.readFile(path.join(f.config.workspace,'docs/CONTEXT_INDEX.md'),'utf8');assert(index.includes('historical'));assert(index.includes('Current scope'));
  }finally{await f.dispose();}
});

test('basic runs actual impacted Node tests and never invokes No-mistakes; full blocks on missing native prerequisites',async()=>{
  const f=await nodeFixture();try {
    const basic=await verify(f.config,{mode:'basic',changed:['src/core.ts']});assert.equal(basic.status,'passed',JSON.stringify(basic)+'\n'+await fs.readFile(path.join(f.config.workspace,'runs',basic.runId,'logs','node-tests.log'),'utf8'));assert.equal(basic.checks[0].executedTests,1);assert(!basic.checks.some(c=>c.id==='no-mistakes'));
    assert.equal((await verify(f.config,{mode:'basic'})).status,'blocked');
    const full=await verify(f.config,{mode:'full'});assert.equal(full.status,'blocked');assert.equal(full.checks[0].executedTests,2);assert(full.checks.some(c=>c.id==='no-mistakes'&&c.status==='blocked'));
  }finally{await f.dispose();}
});

test('TAP artifacts reject missing/zero/failed/cancelled tests',()=>{
  assert.equal(parseNodeTap('# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n').status,'failed');assert.equal(parseNodeTap('').status,'failed');
  assert.equal(parseNodeTap('# tests 2\n# pass 1\n# fail 1\n# cancelled 0\n').status,'failed');
  assert.equal(parseNodeTap('# tests 2\n# pass 1\n# fail 0\n# cancelled 1\n').status,'failed');
});

test('No-mistakes terminal evidence is tied to head/run/all required phases; archives require correct checksum',()=>{
  const result={outcome:'passed',run:{id:'run-1',head_sha:'head-1',status:'completed',steps:['intent','review','test','document','lint'].map(step=>({step,status:'completed'}))}};
  assert.equal(validateGateResult(result,'head-1','run-1'),'passed');assert.equal(validateGateResult(result,'head-2','run-1'),'blocked');
  assert.equal(validateGateResult({...result,outcome:'passed-with-override'},'head-1','run-1'),'blocked');
  result.run.steps[1].status='skipped';assert.equal(validateGateResult(result,'head-1','run-1'),'blocked');assert.deepEqual(localSkip,['rebase','push','pr','ci']);
  assert.throws(()=>verifyArchive(Buffer.from('corrupt'),'123'),'checksum');
});

test('AXI renders bounded TOON while --json keeps complete structured results and errors offer help',async()=>{
  const value={status:'ready',items:Array.from({length:30},(_,id)=>({id}))};assert(!renderAxi(value).includes('id: 29'));assert.equal(JSON.parse(renderAxi(value,true)).items.length,30);
  const f=await nodeFixture();try {
    const cwd=path.resolve(import.meta.dirname,'..');
    const help=await exec(process.execPath,['src/cli.ts','setup','--help'],{cwd});assert(help.stdout.includes('complete project setup'));
    try {await exec(process.execPath,['src/cli.ts','context','damage','--apply','--json'],{cwd});assert.fail('irrelevant flag must fail');}
    catch(error:any) {assert.equal(error.code,2);const err=JSON.parse(error.stderr);assert(err.error.message.includes('not valid'));assert(err.help.length>0);}
    const status=await exec(process.execPath,['src/cli.ts','--project',f.project,'--workspace',f.config.workspace,'--json'],{cwd});assert.equal(JSON.parse(status.stdout).profile,'node');
  }finally{await f.dispose();}
});

test('auto config detects trusted Node recipes but does not execute arbitrary package scripts',async()=>{
  const f=await nodeFixture();try {
    const config=await loadConfig({project:f.project,workspace:f.config.workspace});assert.equal(config.profile,'node');assert.equal(config.testing.modes.basic.commands[0].resultFormat,'node-tap');
    await f.put('package.json',JSON.stringify({scripts:{test:'node -e "process.exit(9)"'}}));
    const other=await loadConfig({project:f.project,workspace:f.config.workspace});assert.equal(other.testing.modes.basic.commands.length,0);
  }finally{await f.dispose();}
});
