import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, hash, safePath, writeJson } from './io.ts';
import { runProcess } from './process.ts';
import type { ToolkitConfig } from './types.ts';

export const noMistakesPin={version:'1.84.0',source:'https://github.com/kunchenguid/no-mistakes',hashes:{
  'win32-x64':'c379c9f1129a0d7e0569516cebfa62e7ed43b28ddaa9a3fa69b884cc3d75ea02',
  'win32-arm64':'7f9d03b42db52f9300fe41cf903bb450013f5ba4d5491d54a4328216cf7b0142',
  'linux-x64':'b0fb8a9df412c5fa1fb92a3584ffa1d4d5b4d6e0d1738efa2f8b88320f8bf1c2',
  'linux-arm64':'8d8cefd927b7f921c207e4dd6c575081dc255dc068f0205f74b52e482bf2f7ab',
  'darwin-x64':'88b1a481924488f55456b3f96070f739b109e19555232e4f8be0a7ebae7c08ac',
  'darwin-arm64':'2e5f838303ab727edccd1a60a4834068024606c68ae7d97fdc0fdeecd7bd4d90'
}} as const;
export function nativeEntry(config:ToolkitConfig){return safePath(config.workspace,'tools','no-mistakes',process.platform==='win32'?'no-mistakes.exe':'no-mistakes');}
export function verifyArchive(data:Buffer,expected:string){if(hash(data)!==expected) throw new Error('No-mistakes archive checksum mismatch');}
export async function installNoMistakes(config:ToolkitConfig,offline=false) {
  const key=`${process.platform}-${process.arch}` as keyof typeof noMistakesPin.hashes;
  const expected=noMistakesPin.hashes[key];if(!expected) throw new Error(`No-mistakes platform unsupported: ${key}`);
  const directory=safePath(config.workspace,'tools','no-mistakes'),entry=nativeEntry(config),receipt=path.join(directory,'install.json');
  if(await exists(entry) && await exists(receipt)) {
    const previous=JSON.parse(await fs.readFile(receipt,'utf8'));
    if(previous.version===noMistakesPin.version && previous.archiveHash===expected && previous.binaryHash===hash(await fs.readFile(entry))) return {tool:'no-mistakes',version:noMistakesPin.version,status:'reused',directory};
  }
  await fs.mkdir(directory,{recursive:true});
  const os={win32:'windows',linux:'linux',darwin:'darwin'}[process.platform as 'win32'|'linux'|'darwin'];
  const arch=process.arch==='x64'?'amd64':'arm64',suffix=process.platform==='win32'?'zip':'tar.gz';
  const archive=path.join(directory,`no-mistakes-v${noMistakesPin.version}-${os}-${arch}.${suffix}`);
  const url=`${noMistakesPin.source}/releases/download/v${noMistakesPin.version}/${path.basename(archive)}`;
  let data:Buffer;
  if(await exists(archive) && hash(await fs.readFile(archive))===expected) data=await fs.readFile(archive);
  else {
    if(offline) throw new Error('Pinned No-mistakes binary/archive is not cached; run online setup first');
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`No-mistakes download HTTP ${response.status}`);
    data=Buffer.from(await response.arrayBuffer());verifyArchive(data,expected);await fs.writeFile(archive,data);
  }
  const log=safePath(config.workspace,'setup-logs','no-mistakes-extract.log');
  const extraction=await runProcess(process.platform==='win32'?'powershell.exe':'tar',process.platform==='win32'
    ?['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../src/adapters/extract-zip.ps1',import.meta.url)),'-Source',archive,'-Destination',directory]
    :['-xf',archive,'-C',directory],{cwd:directory,timeoutMs:60000,log});
  if(extraction.exitCode!==0 || !await exists(entry)) throw new Error(`No-mistakes extraction failed; see ${log}`);
  await writeJson(receipt,{version:noMistakesPin.version,archiveHash:expected,binaryHash:hash(await fs.readFile(entry)),url});
  return {tool:'no-mistakes',version:noMistakesPin.version,status:'installed',directory,log};
}
