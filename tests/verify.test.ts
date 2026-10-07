import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fixture } from './helpers.ts';
import { verify, parseNUnitXml, editorBusy } from '../src/verify.ts';
import { checkpoint, handoff, resume } from '../src/state.ts';
import { runProcess } from '../src/process.ts';

test('NUnit requires actual executed tests and Passed root status',()=>{
  assert.equal(parseNUnitXml('<test-run result="Passed" passed="0" failed="0" />').status,'failed');
  assert.equal(parseNUnitXml('<test-run result="Passed" passed="2" failed="0" />').executed,2);
  assert.equal(parseNUnitXml('<test-run result="Failed" passed="1" failed="1" />').status,'failed');
  assert.throws(()=>parseNUnitXml(''));
});
test('Unity v2 readiness waits for compile, domain reload, refresh and ongoing tests',()=>{
  assert(editorBusy({compilation:{is_domain_reload_pending:true}}));assert(editorBusy({assets:{refresh:{is_refresh_in_progress:true}}}));
  assert(editorBusy({tests:{is_running:true}}));assert(!editorBusy({compilation:{is_compiling:false,is_domain_reload_pending:false}}));
});
test('batch rendering preflight blocks unsupported coroutine tests before launching an Editor',async()=>{
  const f=await fixture();try{
    await f.put('Assets/Tests/CaptureTests.cs','namespace Game.Tests; class CaptureTests { [UnityTest] IEnumerator Capture() { yield return new UnityEngine.WaitForEndOfFrame(); } }');
    f.config.unity.editorPath=process.execPath;
    const result=await verify(f.config,{mode:'basic',runner:'batch',platforms:['PlayMode'],tests:['Game.Tests.CaptureTests']});
    assert.equal(result.status,'blocked');assert(result.checks[0].details.includes('WaitForEndOfFrame'));
    assert(!(await fs.stat(path.join(f.workspace,'batch-project')).catch(()=>undefined)));
  }finally{await f.dispose();}
});
test('process logs redact credentials across output chunks and retain Unicode',async()=>{
  const f=await fixture();try{
    const log=path.join(f.workspace,'split.log');
    await runProcess(process.execPath,['-e',"process.stdout.write('api_');setTimeout(()=>process.stdout.write('key=private-value\\nTiếng Việt\\n'),30)"],{cwd:f.project,timeoutMs:5000,log});
    const saved=await fs.readFile(log,'utf8');assert(!saved.includes('private-value'));assert(saved.includes('Tiếng Việt'));
  }finally{await f.dispose();}
});
test('basic/full run configured checks and save evidence; handoff invalidates tests after source changes',async()=>{
  const f=await fixture();try{
    await checkpoint(f.config,{id:'feature',goal:'Player damage'});
    const runner=path.join(f.directory,'fake-test.mjs');
    await fs.writeFile(runner,"import fs from 'node:fs'; fs.writeFileSync(process.argv[2],'<test-run result=\"Passed\" passed=\"2\" failed=\"0\" />'); console.log('password=private-value');");
    const check={id:'targeted',executable:process.execPath,args:[runner,'{runDir}/tests.xml'],testResults:'tests.xml'};
    f.config.testing.runner='commands';f.config.testing.modes.basic.commands=[check];f.config.testing.modes.full.commands=[check,{id:'lint',executable:process.execPath,args:['-e','console.log("lint okay")']}];
    const basic=await verify(f.config,{mode:'basic',task:'current'});assert.equal(basic.status,'passed');assert.equal(basic.checks.length,1);
    const full=await verify(f.config,{mode:'full',task:'current'});assert.equal(full.checks.length,3);assert.equal(full.checks[2].status,'skipped');assert.equal(full.status,'passed');
    const log=await fs.readFile(path.join(f.workspace,'runs',basic.runId,'logs','targeted.log'),'utf8');assert(!log.includes('private-value'));
    assert.equal((await handoff(f.config,'current')).fresh,true);
    await f.put('Assets/Scripts/Player.cs','namespace Game; class Player { void Changed() {} }');assert.equal((await handoff(f.config,'current')).fresh,false);
  }finally{await f.dispose();}
});
test('zero tests, missing XML, command failure and missing basic filter never pass',async()=>{
  const f=await fixture();try{
    f.config.testing.runner='commands';f.config.testing.modes.basic.commands=[{id:'empty',executable:process.execPath,args:['-e',''],testResults:'missing.xml'}];
    assert.equal((await verify(f.config,{mode:'basic'})).status,'failed');
    f.config.testing.modes.basic.commands=[{id:'broken',executable:process.execPath,args:['-e','process.exit(4)']}];
    assert.equal((await verify(f.config,{mode:'basic'})).status,'failed');
    f.config.testing.runner='mcp';assert.equal((await verify(f.config,{mode:'basic'})).status,'blocked');
  }finally{await f.dispose();}
});
test('verification becomes stale if the command changes source',async()=>{
  const f=await fixture();try{
    f.config.testing.runner='commands';f.config.testing.modes.basic.commands=[{id:'mutating-fixture',executable:process.execPath,
      args:['-e',"require('fs').writeFileSync(process.argv[1], 'namespace Game; class Player { void Mutated() {} }')",path.join(f.project,'Assets/Scripts/Player.cs')]}];
    assert.equal((await verify(f.config,{mode:'basic'})).status,'stale');
  }finally{await f.dispose();}
});
test('MCP verifies project identity, negotiates tools and stores positive test results',async()=>{
  const f=await fixture();let starts=0;let wrongProject=false;let unknownJob=false;
  const server=createServer(async(req,res)=>{
    if(req.method==='DELETE') {res.writeHead(204);res.end();return;}
    let raw='';for await(const part of req) raw+=part;const message=JSON.parse(raw);
    if(message.id===undefined) {res.writeHead(202);res.end();return;}
    let result:unknown={};
    if(message.method==='initialize') result={protocolVersion:'2025-03-26',capabilities:{}};
    if(message.method==='resources/list') result={resources:[{uri:'mcpforunity://project/info'},{uri:'mcpforunity://editor/state'}]};
    if(message.method==='resources/read') result={contents:[{text:JSON.stringify(message.params.uri.endsWith('/project/info')?{project_root:wrongProject?f.project+'-other':f.project}:{is_compiling:false,ready_for_tools:true})}]};
    if(message.method==='tools/list') result={tools:[{name:'run_tests',inputSchema:{properties:{mode:{},test_names:{}}}},{name:'get_test_job',inputSchema:{properties:{job_id:{}}}}]};
    if(message.method==='tools/call') {
      if(message.params.name==='run_tests') {starts++;result={content:[{text:JSON.stringify({success:true,data:{job_id:unknownJob?undefined:'job-one',status:'running'}})}]};}
      else result={content:[{text:JSON.stringify({success:true,data:{status:'succeeded',result:{summary:{passed:2,failed:0}}}})}]};
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=server.address();if(!address||typeof address==='string') throw new Error('No port');
    f.config.unity.mcpUrl=`http://127.0.0.1:${address.port}/mcp`;
    await checkpoint(f.config,{id:'mcp-task',goal:'Verify MCP test runner'});
    const result=await verify(f.config,{mode:'basic',tests:['Game.Tests.PlayerTests.PlayerTakesDamage']});assert.equal(result.status,'passed');assert.equal(result.checks[0].executedTests,2);assert.equal(starts,1);
    wrongProject=true;assert.equal((await verify(f.config,{mode:'basic',tests:['Game.Tests.PlayerTests.PlayerTakesDamage']})).status,'blocked');assert.equal(starts,1);
    wrongProject=false;unknownJob=true;
    assert.equal((await verify(f.config,{mode:'basic',tests:['Game.Tests.PlayerTests.PlayerTakesDamage']})).status,'blocked');
    assert((await resume(f.config,'current')).unfinishedOperations.some(operation=>operation.kind==='unity-tests'));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await f.dispose();}
});
