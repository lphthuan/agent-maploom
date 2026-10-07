import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { releaseFiles, repositoryRoot } from './release-files.ts';
import { packageManager, toolPins } from '../src/setup.ts';
import { noMistakesPin } from '../src/native-tool.ts';

const exec=promisify(execFile);
const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
async function main() {
  if(process.platform!=='win32') throw new Error('The source ZIP release builder currently requires Windows. Use the Windows release workflow.');
  const manifest=JSON.parse(await fs.readFile(path.join(repositoryRoot,'package.json'),'utf8'));
  if(manifest.name!=='agent-maploom' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid release package name/version');
  const files=await releaseFiles();
  const cache=path.join(repositoryRoot,'.cache','release');await fs.mkdir(cache,{recursive:true});
  const build=await fs.mkdtemp(path.join(cache,'build-'));
  const sourceParent=path.join(build,'source'),staged=path.join(sourceParent,`agent-maploom-${manifest.version}`);
  const hashes=[];
  for(const file of files) {
    const data=await fs.readFile(path.join(repositoryRoot,file));
    const target=path.join(staged,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);
    hashes.push({path:file,bytes:data.length,sha256:sha(data)});
  }
  const pm=await packageManager();
  await exec(process.execPath,[path.join(repositoryRoot,'node_modules','typescript','bin','tsc'),'--project',path.join(repositoryRoot,'tsconfig.build.json'),'--outDir',path.join(staged,'lib')],{cwd:repositoryRoot,windowsHide:true,maxBuffer:4*1024*1024});
  const compiled:{path:string;bytes:number;sha256:string}[]=[];
  const visitCompiled=async(directory:string)=>{for(const child of await fs.readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,child.name);
    if(child.isDirectory()) await visitCompiled(file);else {const data=await fs.readFile(file);compiled.push({path:path.relative(staged,file).replaceAll('\\','/'),bytes:data.length,sha256:sha(data)});}
  }};
  await visitCompiled(path.join(staged,'lib'));
  const args=pm.kind==='pnpm'?[pm.file,'pack','--pack-destination',build,'--skip-manifest-obfuscation']:[pm.file,'pack','--pack-destination',build,'--ignore-scripts'];
  const packed=await exec(process.execPath,args,{cwd:staged,windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,npm_config_ignore_scripts:'true'}});
  await fs.writeFile(path.join(build,'pack.log'),packed.stdout+packed.stderr);
  const tgz=`${manifest.name}-${manifest.version}.tgz`,zip=`agent-maploom-v${manifest.version}-windows-source.zip`;
  await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(repositoryRoot,'scripts','zip-release.ps1'),'-Source',sourceParent,'-Destination',path.join(build,zip)],{windowsHide:true,maxBuffer:1024*1024});
  const archives=[];
  for(const file of [zip,tgz]) {const data=await fs.readFile(path.join(build,file));archives.push({name:file,bytes:data.length,sha256:sha(data)});}
  const receipt={schemaVersion:1,name:manifest.name,version:manifest.version,node:process.version,sourceFiles:hashes,compiledFiles:compiled,archives,
    helpers:{...Object.fromEntries(Object.entries(toolPins).map(([name,pin])=>[name,pin.version])),noMistakes:noMistakesPin.version},
    notes:['Source-only distribution; dependencies/helpers are installed by bootstrap.','No private pilot data, generated state or credentials bundled.']};
  const receiptData=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
  await fs.writeFile(path.join(build,'release-manifest.json'),receiptData);
  const sums=[...archives,{name:'release-manifest.json',sha256:sha(receiptData)}].map(item=>`${item.sha256}  ${item.name}`).join('\n')+'\n';
  await fs.writeFile(path.join(build,'SHA256SUMS.txt'),sums);
  const destination=path.join(repositoryRoot,'dist');await fs.mkdir(destination,{recursive:true});
  for(const file of [zip,tgz,'release-manifest.json','SHA256SUMS.txt']) await fs.copyFile(path.join(build,file),path.join(destination,file));
  console.log(JSON.stringify({status:'packaged',version:manifest.version,publicFiles:files.length,assets:archives,checksums:'dist/SHA256SUMS.txt'},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
