import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allowedPublicPath, repositoryRoot } from './release-files.ts';
import { packageManager } from '../src/setup.ts';

const exec=promisify(execFile);
async function main() {
  const offline=process.argv.includes('--offline'),withHelpers=process.argv.includes('--with-helpers');
  if(offline && withHelpers) throw new Error('A fresh helper installation needs an online smoke check.');
  const dist=path.join(repositoryRoot,'dist'),manifest=JSON.parse(await fs.readFile(path.join(dist,'release-manifest.json'),'utf8'));
  for(const row of (await fs.readFile(path.join(dist,'SHA256SUMS.txt'),'utf8')).trim().split(/\r?\n/)) {
    const parsed=/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(row);assert(parsed,'Malformed checksum entry');
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(dist,parsed[2]))).digest('hex'),parsed[1]);
  }
  const tar=process.platform==='win32'?'tar.exe':'tar';
  const tgz=path.join(dist,`agent-maploom-${manifest.version}.tgz`);
  const listed=await exec(tar,['-tf',tgz],{windowsHide:true});
  const contents=listed.stdout.trim().split(/\r?\n/).filter(file=>!file.endsWith('/'));
  for(const file of contents) {assert(file.startsWith('package/'));assert(allowedPublicPath(file.slice(8)),`Unexpected npm entry: ${file}`);}
  for(const file of ['package/bin/agent-maploom.mjs','package/lib/cli.js','package/LICENSE','package/README.vi.md']) assert(contents.includes(file),`Missing ${file}`);
  const cache=path.join(repositoryRoot,'.cache','release');await fs.mkdir(cache,{recursive:true});
  const temporary=await fs.mkdtemp(path.join(cache,'smoke-'));
  const install=path.join(temporary,'install');await fs.mkdir(install);
  await fs.writeFile(path.join(install,'package.json'),'{"private":true}\n');
  const pm=await packageManager();
  const installArgs=pm.kind==='pnpm'?[pm.file,'add',tgz,'--prod','--ignore-scripts','--store-dir',path.join(repositoryRoot,'.cache','pnpm-store')]
    :[pm.file,'install',tgz,'--omit=dev','--ignore-scripts','--no-audit','--no-fund'];
  if(offline) installArgs.push('--offline');
  const installed=await exec(process.execPath,installArgs,{cwd:install,timeout:300000,windowsHide:true,maxBuffer:4*1024*1024});
  await fs.writeFile(path.join(temporary,'install.log'),installed.stdout+installed.stderr);
  const entry=path.join(install,'node_modules','agent-maploom','bin','agent-maploom.mjs');
  const invoke=async(args:string[],cwd=temporary)=>{
    const result=await exec(process.execPath,[entry,...args],{cwd,windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,NODE_TEST_CONTEXT:undefined}});
    return args.includes('--json')?JSON.parse(result.stdout):result.stdout;
  };
  assert.match(await invoke(['--help']),/AgentMaploom 0\.2\.0/);
  const unity=path.join(temporary,'Unity smoke Việt');
  const put=async(root:string,file:string,content:string)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);};
  await put(unity,'ProjectSettings/ProjectVersion.txt','m_EditorVersion: 6000.3.24f1\n');
  await put(unity,'Packages/manifest.json','{"dependencies":{}}');
  await put(unity,'Assets/Scripts/DamageCooldown.cs','namespace Smoke; public class DamageCooldown { public int ApplyDamage(int hp,int amount) { return hp-amount; } }');
  await put(unity,'AGENTS.md','# User rules\nThe user controls scenes and prefabs.\n');
  await invoke(['init','--attach','--project',unity,'--json']);
  const wrapper=await exec(process.execPath,[path.join(unity,'.agentkit','agentkit.mjs'),'--json'],{windowsHide:true,maxBuffer:1024*1024});assert.equal(JSON.parse(wrapper.stdout).profile,'unity');
  assert.match(await fs.readFile(path.join(unity,'AGENTS.md'),'utf8'),/SYSTEM_MAP.md/);
  const context=await invoke(['context','ApplyDamage DamageCooldown','--project',unity,'--json']);
  assert(context.targets.includes('Assets/Scripts/DamageCooldown.cs'));
  const rules=await fs.readFile(path.join(unity,'Docs','Agent','PROJECT_RULES.md'),'utf8');assert.match(rules,/user controls scenes/i);
  const nodeProject=path.join(temporary,'Node smoke');
  await put(nodeProject,'package.json','{"type":"module","scripts":{"test":"node --test tests/*.test.js"}}');
  await put(nodeProject,'src/damage.js','export const damage=(hp,amount)=>hp-amount;');
  await put(nodeProject,'tests/damage.test.js',"import test from 'node:test'; import assert from 'node:assert/strict'; import {damage} from '../src/damage.js'; test('damage changes health',()=>assert.equal(damage(8,3),5));");
  await invoke(['init','--attach','--project',nodeProject,'--json']);
  await invoke(['task','--task','package-smoke','--goal','Verify damage changes health','--project',nodeProject,'--json']);
  const verified=await invoke(['verify','--mode','basic','--changed','src/damage.js','--task','current','--project',nodeProject,'--json']);
  assert.equal(verified.status,'passed');assert.equal(verified.checks.find((c:any)=>c.id==='node-tests').executedTests,1);
  assert(!verified.checks.some((c:any)=>c.id==='no-mistakes'));
  await invoke(['checkpoint','--task','current','--done','Damage smoke completed','--next','Resume in another session','--project',nodeProject,'--json']);
  assert.match(JSON.stringify(await invoke(['resume','--task','current','--project',nodeProject,'--json'])),/Verify damage changes health/);
  const handoff=await invoke(['handoff','--task','current','--project',nodeProject,'--json']);assert.equal(handoff.verification,'passed');assert.equal(handoff.fresh,true);
  await invoke(['memory','add','Damage smoke persists','--source','src/damage.js','--project',nodeProject,'--json']);
  assert.match(JSON.stringify(await invoke(['memory','recall','Damage smoke','--project',nodeProject,'--json'])),/Damage smoke persists/);
  let zipBootstrap='omitted: offline or non-Windows';let helpers:any;
  if(process.platform==='win32' && !offline) {
    const extracted=path.join(temporary,'extracted');await fs.mkdir(extracted);
    const zip=path.join(dist,`agent-maploom-v${manifest.version}-windows-source.zip`);
    const zipList=(await exec(tar,['-tf',zip],{windowsHide:true})).stdout.trim().split(/\r?\n/).filter(file=>!file.endsWith('/'));
    for(const file of zipList) {assert(file.startsWith(`agent-maploom-${manifest.version}/`));assert(allowedPublicPath(file.slice(`agent-maploom-${manifest.version}/`.length)),`Unexpected ZIP entry: ${file}`);}
    await exec(tar,['-xf',zip,'-C',extracted],{windowsHide:true});
    const source=path.join(extracted,`agent-maploom-${manifest.version}`);
    const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(source,'bootstrap.ps1'),'-Project',unity,...withHelpers?[]:['-SkipHelpers']];
    let bootstrapped;
    try {bootstrapped=await exec('powershell.exe',args,{cwd:source,timeout:900000,windowsHide:true,maxBuffer:8*1024*1024});}
    catch(error:any) {await fs.writeFile(path.join(temporary,'zip-bootstrap.log'),String(error.stdout ?? '')+String(error.stderr ?? ''));throw new Error(`ZIP bootstrap failed; inspect ${path.join(temporary,'zip-bootstrap.log')}`);}
    await fs.writeFile(path.join(temporary,'zip-bootstrap.log'),bootstrapped.stdout+bootstrapped.stderr);
    assert.match(bootstrapped.stdout,/Bootstrap complete/);zipBootstrap=withHelpers?'passed: complete helper setup':'passed: core setup';
    if(withHelpers) {
      const setup=JSON.parse(await fs.readFile(path.join(unity,'.agentkit','setup-report.json'),'utf8'));
      assert.equal(setup.status,'ready');assert.equal(setup.helpers.results.length,4);assert.equal(setup.graft.status,'built');
      helpers=setup.helpers.results.map((r:any)=>({tool:r.tool,version:r.version,status:r.status}));
    }
  }
  const report={status:'passed',version:manifest.version,archiveChecksums:true,packageEntries:contents.length,installedCli:true,csharpContext:true,
    preservedRules:true,nodeTestsExecuted:1,resumeAndMemory:true,freshHandoff:true,zipBootstrap,helpers,
    omitted:['Live Unity Editor/gameplay/mobile build','Native No-mistakes full gate']};
  await fs.writeFile(path.join(temporary,'smoke-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,report:path.join(temporary,'smoke-report.json')},null,2));
}
main().catch(error=>{console.error(error.stack ?? error.message);process.exitCode=1;});
