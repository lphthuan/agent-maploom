import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.ts';
import { parseCSharp, scan } from '../src/scan.ts';
import { writeMap } from '../src/map.ts';
import { codeContext } from '../src/context.ts';
import { checkpoint, remember, recall, resume, taskId, journalEntries } from '../src/state.ts';
import { appendJournal, hash, redact, writeJson } from '../src/io.ts';
import { init } from '../src/init.ts';
import { prepareBatchProject } from '../src/batch-project.ts';

test('AST finds nested namespaces/types/methods and tests with source lines',async()=>{
  const result=await parseCSharp('namespace Game.Core { public class Health { [Test] public void Changes() {} } }','Health.cs');
  assert.equal(result.parseErrors,0);assert.equal(result.symbols.find(symbol=>symbol.name==='Changes')?.namespace,'Game.Core.Health');
  assert.deepEqual(result.testNames,['Game.Core.Health.Changes']);
});
test('Unity scan resolves GUID/assembly edges, excludes secrets and caches, then tracks changed/deleted files',async()=>{
  const f=await fixture();try{
    await f.put('Library/Cache.cs','this is not valid C#');await f.put('.env','API_KEY=private-value');
    const first=await scan(f.config);assert.equal(first.counts.parsedCSharp,2);assert.equal(first.counts.errors,0);
    assert(first.edges.some(edge=>edge.kind==='assembly-reference'&&edge.to==='Game.Domain'));
    assert(first.edges.some(edge=>edge.kind==='asset-reference'&&edge.to==='Assets/Scripts/Player.cs'));
    assert(first.files.some(file=>file.path==='.env'&&file.status==='excluded'));
    const second=await scan(f.config);assert.equal(second.sourceHash,first.sourceHash);assert.equal(second.changedFiles.length,0);assert.equal(second.counts.reusedCSharp,2);
    await f.put('Assets/Scripts/Player.cs','namespace Game; class Player { void Reset() {} }');await fs.unlink(path.join(f.project,'Assets/Tests/PlayerTests.cs'));
    const third=await scan(f.config);assert.notEqual(third.sourceHash,first.sourceHash);assert(third.changedFiles.includes('Assets/Tests/PlayerTests.cs'));
  }finally{await f.dispose();}
});
test('map/context reference real files; retrieval stays bounded and does not mutate authoring assets',async()=>{
  const f=await fixture();try{
    const scene=path.join(f.project,'Assets/Scenes/Arena.unity');const before=hash(await fs.readFile(scene));
    const graph=await scan(f.config);const output=await writeMap(f.config,graph);
    const text=await fs.readFile(output.map,'utf8');assert(text.includes('```mermaid'));assert(text.includes('Game.Domain'));assert(text.includes('Arena.unity'));
    f.config.context.maxChars=400;const context=await codeContext(f.config,'Player Health');assert(context.charCount<=400);assert(context.candidates>0);
    assert.equal(hash(await fs.readFile(scene)),before);
  }finally{await f.dispose();}
});
test('context prefers a relevant method over an early namespace match',async()=>{
  const f=await fixture();try{
    await f.put('Assets/Scripts/Player.cs','namespace Game.Matches;\nclass Player {\n'+Array.from({length:40},()=> '// unrelated declaration context').join('\n')+'\n void ResetMatch() { int remaining = 0; }\n}');
    const context=await codeContext(f.config,'match reset','Assets/Scripts');assert(context.text.includes('void ResetMatch()'));
  }finally{await f.dispose();}
});
test('checkpoint survives resume, detects changed source and unresolved journal operations',async()=>{
  const f=await fixture();try{
    await checkpoint(f.config,{id:'feature-1',goal:'Damage implementation',done:['Domain updated'],next:['Run tests'],wiring:['User binds component']});
    await appendJournal(f.workspace,{event:'operation-start',operationId:'uncertain-write'});
    await f.put('Assets/Scripts/Player.cs','namespace Game; class Player { void Heal() {} }');
    const result=await resume(f.config,'current');assert(result.sourceChanged);assert.equal(result.state.goal,'Damage implementation');assert.equal(result.unfinishedOperations.length,1);
    assert.throws(()=>taskId('../outside'));
    await fs.appendFile(path.join(f.workspace,'journal.jsonl'),'{"partial":');assert.equal((await journalEntries(f.config)).incompleteTail,true);
    await appendJournal(f.workspace,{event:'checkpoint',operationId:'after-recovery'});
    const recovered=await journalEntries(f.config);assert.equal(recovered.incompleteTail,false);assert(recovered.entries.some(event=>event.event==='journal-tail-recovered'));
  }finally{await f.dispose();}
});
test('memory scopes projects, supersedes old lessons and redacts secrets without corrupting JSON',async()=>{
  const f=await fixture();try{
    const old=await remember(f.config,'Player damage must be resolved first',[]);
    await remember(f.config,'Player damage updated; password="private-value"',['Docs/Rules.md'],old.id);
    const found=await recall(f.config,'Player');assert.equal(found.length,1);assert(!found[0].text.includes('private-value'));
    assert.equal((await recall({...f.config,project:f.project+'-different'},'Player')).length,0);
    await writeJson(path.join(f.workspace,'secret.json'),{apiKey:'secret',message:'password=secret'});
    const json=JSON.parse(await fs.readFile(path.join(f.workspace,'secret.json'),'utf8'));assert.equal(json.apiKey,'[REDACTED]');assert(!json.message.includes('secret'));
    assert(!redact('Bearer abcdefghijklmnopqrstuvwxyz').includes('abcdefghijklmnopqrstuvwxyz'));
  }finally{await f.dispose();}
});
test('init attachment preserves original rules and is idempotent while leaving Unity assets intact',async()=>{
  const f=await fixture();try{
    await f.put('AGENTS.md','# Original rules\nNever change damage ordering.\n');
    const sceneBefore=await fs.readFile(path.join(f.project,'Assets/Scenes/Arena.unity'),'utf8');
    const first=await init(f.config,true);assert(first.preservedRules);assert.equal(await fs.readFile(first.preservedRules!,'utf8'),'# Original rules\nNever change damage ordering.\n');
    assert(first.preservedRules!.includes(path.join('Docs','Agent','PROJECT_RULES.md')));
    await init(f.config,true);assert((await fs.readFile(path.join(f.project,'AGENTS.md'),'utf8')).startsWith('# Unity agent map'));
    assert.equal(await fs.readFile(path.join(f.project,'Assets/Scenes/Arena.unity'),'utf8'),sceneBefore);
  }finally{await f.dispose();}
});
test('isolated batch snapshot preserves original assets and repairs changes only in the copy',async()=>{
  const f=await fixture();try{
    const original=path.join(f.project,'Assets/Scenes/Arena.unity');const contents=await fs.readFile(original,'utf8');
    const graph=await scan(f.config);const run=path.join(f.workspace,'run');
    const first=await prepareBatchProject(f.config,graph,run);
    const copied=path.join(first.project,'Assets/Scenes/Arena.unity');await fs.writeFile(copied,'Unity can reserialize this copy');
    await fs.writeFile(path.join(first.project,'Assets/extra.asset'),'temporary test asset');
    await prepareBatchProject(f.config,graph,run);
    assert.equal(await fs.readFile(copied,'utf8'),contents);assert.equal(await fs.readFile(original,'utf8'),contents);
    assert(!(await fs.stat(path.join(first.project,'Assets/extra.asset')).catch(()=>undefined)));
    assert((JSON.parse(await fs.readFile(first.evidence,'utf8'))).files.some((file:{path:string})=>file.path==='Assets/Scenes/Arena.unity'));
  }finally{await f.dispose();}
});
