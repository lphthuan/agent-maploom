import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allowedPublicPath, releaseFiles, repositoryRoot } from '../scripts/release-files.ts';
import { fixture } from './helpers.ts';

test('publication rejects generated state, private pilot data, credentials and traversal',async()=>{
  for(const file of ['.agentkit/memory.jsonl','.cache/token','pilot/GeneBonk/graph.json','analysis/video.mp4','examples/GeneBonk.json','docs/CORE_SETUP_RESULT.md','src/../../.env','src/.env','src/key.pem','C:/private.ts']) assert.equal(allowedPublicPath(file),false,file);
  const files=await releaseFiles();assert(files.includes('LICENSE'));assert(files.includes('bin/agent-maploom.mjs'));assert(files.includes('README.vi.md'));
  for(const file of files) assert(allowedPublicPath(file));
  const f=await fixture();try {
    await fs.mkdir(path.join(f.directory,'src'),{recursive:true});
    // Even a public-path symlink is refused rather than publishing data from outside the allowlist.
    const alias=path.join(f.directory,'src','alias');await fs.symlink(f.project,alias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(releaseFiles(f.directory,['src']),/symlink/);
  }finally{await f.dispose();}
});

test('Windows ZIP installation preserves Vietnamese names and works in Unicode directories',{skip:process.platform!=='win32'},async()=>{
  const f=await fixture();try {
    const source=path.join(f.directory,'Nguồn Việt'),destination=path.join(f.directory,'Đích Việt');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'Đề mô.txt'),'Nội dung Việt');
    const archive=path.join(f.directory,'Tệp Việt.zip'),exec=promisify(execFile);
    await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repositoryRoot,'scripts','zip-release.ps1'),'-Source',source,'-Destination',archive],{windowsHide:true});
    await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repositoryRoot,'src','adapters','extract-zip.ps1'),'-Source',archive,'-Destination',destination],{windowsHide:true});
    assert.equal(await fs.readFile(path.join(destination,'Đề mô.txt'),'utf8'),'Nội dung Việt');
  }finally{await f.dispose();}
});

test('public Markdown links point to shipped documentation instead of local absolute paths',async()=>{
  for(const file of (await releaseFiles()).filter(file=>file.endsWith('.md'))) {
    const body=await fs.readFile(path.join(repositoryRoot,file),'utf8');
    assert(!/\]\(<?[A-Z]:[\\/]/.test(body),`Local link in ${file}`);
    for(const match of body.matchAll(/\]\(([^)]+)\)/g)) {
      const target=match[1].replace(/^<|>$/g,'').split('#')[0];
      if(!target || /^[a-z]+:/.test(target)) continue;
      await fs.access(path.resolve(repositoryRoot,path.dirname(file),target));
    }
  }
});
