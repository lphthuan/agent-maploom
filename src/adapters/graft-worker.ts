import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const request=JSON.parse(await readFile(process.argv[2],'utf8')) as {module:string;project:string;output:string;onlyDirs:string[]};
// Graft 0.21.1 eagerly imports native grammars that have no Windows prebuild.
// This worker is scoped to Unity C#: unused Kotlin/Swift grammars are disabled.
if(process.platform==='win32') registerHooks({resolve(specifier,context,nextResolve){
  if(['tree-sitter-kotlin','tree-sitter-swift'].includes(specifier) && context.parentURL?.endsWith('/graph/extract.js'))
    return {url:new URL(import.meta.url.endsWith('.ts')?'./unused-native-grammar.ts':'./unused-native-grammar.js',import.meta.url).href,shortCircuit:true};
  return nextResolve(specifier,context);
}});
const {Graft}=await import(pathToFileURL(request.module).href);
// Use the pinned public API: the CLI performs global upkeep before build.
const engine=new Graft({contextDir:request.output});
const result=await engine.graph(request.project,{llm:false,lsp:false,onlyDirs:request.onlyDirs});
if(result.languages.some((language:string)=>['kotlin','swift'].includes(language))) throw new Error('Kotlin/Swift are outside the Windows Unity adapter; core C# map is independent');
console.log(JSON.stringify({files:result.files,parsed:result.parsed,reused:result.reused,nodes:result.nodes,edges:result.edges,cards:result.cards,languages:result.languages,contextDir:result.contextDir,disabledNativeGrammars:process.platform==='win32'?['kotlin','swift']:[]}));
