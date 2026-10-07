import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const publicEntries=[
  '.gitattributes','.gitignore','.github','AGENTS.md','LICENSE','README.md','README.vi.md',
  'CHANGELOG.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.build.json',
  'agent-maploom.ps1','agentkit.ps1','bootstrap.ps1','bin','src','tests',
  'scripts/release-files.ts','scripts/package-release.ts','scripts/smoke-package.ts',
  'scripts/zip-release.ps1','scripts/check-memory.ts',
  'examples/unity-mobile.json','examples/node.json',
  'docs/GETTING_STARTED.md','docs/CONFIGURATION.md','docs/TESTING.md','docs/ARCHITECTURE.md',
  'docs/DEVELOPMENT.md','docs/RELEASING.md','docs/Agent/PROJECT_RULES.md','docs/releases'
];
export function allowedPublicPath(file:string) {
  const normalized=file.replaceAll('\\','/');
  if(normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) return false;
  if(/(^|\/)(?:\.agentkit|\.cache|\.git|node_modules|pilot|analysis|dist|\.vscode)(\/|$)/i.test(normalized)) return false;
  if(/(^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|log))$/i.test(normalized)) return false;
  return normalized.startsWith('lib/') || publicEntries.some(entry=>normalized===entry || ['src','tests','bin','.github','docs/releases'].includes(entry) && normalized.startsWith(entry+'/'));
}
export async function releaseFiles(root=repositoryRoot,entries:readonly string[]=publicEntries):Promise<string[]> {
  const files:string[]=[];
  const visit=async(file:string)=>{
    if(!allowedPublicPath(file)) throw new Error(`Non-public release path: ${file}`);
    const entry=await fs.lstat(path.join(root,file));
    if(entry.isSymbolicLink()) throw new Error(`Release symlink refused: ${file}`);
    if(entry.isDirectory()) for(const child of (await fs.readdir(path.join(root,file))).sort()) await visit(file+'/'+child);
    else if(entry.isFile()) files.push(file);
    else throw new Error(`Unsupported release entry: ${file}`);
  };
  for(const entry of entries) await visit(entry);
  return files.sort();
}
