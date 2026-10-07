import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaults } from '../src/config.ts';
import { inside } from '../src/io.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','.cache','tests');
export async function fixture() {
  await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'case-'));
  const project=path.join(directory,'Unity Project Việt');const workspace=path.join(directory,'state');
  const put=async(file:string,text:string)=>{const target=path.join(project,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);};
  await put('ProjectSettings/ProjectVersion.txt','m_EditorVersion: 6000.3.24f1\n');
  await put('Packages/manifest.json',JSON.stringify({dependencies:{'com.unity.test-framework':'1.6.0'}}));
  await put('Assets/Scripts/Game.Domain.asmdef',JSON.stringify({name:'Game.Domain',references:[],noEngineReferences:true}));
  await put('Assets/Scripts/Game.Domain.asmdef.meta','guid: 11111111111111111111111111111111\n');
  await put('Assets/Scripts/Player.cs','namespace Game; public class Player { public int Health { get; private set; } public void Damage(int amount) { Health -= amount; } }\n');
  await put('Assets/Scripts/Player.cs.meta','guid: 22222222222222222222222222222222\n');
  await put('Assets/Tests/Game.Tests.asmdef',JSON.stringify({name:'Game.Tests',references:['GUID:11111111111111111111111111111111']}));
  await put('Assets/Tests/PlayerTests.cs','namespace Game.Tests; public class PlayerTests { [Test] public void PlayerTakesDamage() {} }');
  await put('Assets/Scenes/Arena.unity','--- !u!114 &1\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: 22222222222222222222222222222222, type: 3}\n');
  const config=defaults(project,workspace);
  config.testing.noMistakes={enabled:false,timeoutMs:60000}; // runner fixtures isolate native gate tests
  const dispose=async()=>{if(!inside(root,directory)) throw new Error('Fixture cleanup escaped workspace');await fs.rm(directory,{recursive:true,force:true});};
  return {directory,project,workspace,put,config,dispose};
}
