import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter';
import { errorMessage, exists, hash, inside, now, readJson, safePath, slash, writeJson } from './io.ts';
import type { AssemblyRecord, FileRecord, ProjectGraph, SourceSymbol, ToolkitConfig } from './types.ts';
import { parseTypeScript, resolveImport } from './ts-source.ts';

const require = createRequire(import.meta.url);
const textExtensions = new Set(['.cs','.asmdef','.asmref','.meta','.unity','.prefab','.asset','.inputactions','.anim','.controller','.overridecontroller','.mat','.rendertexture','.mask','.shadergraph','.shadersubgraph','.json','.md','.txt','.shader','.compute','.hlsl','.cginc','.cpp','.c','.h','.mm','.m','.java','.xml','.uxml','.uss','.yaml','.yml','.toml','.csproj','.sln','.ps1','.js','.ts','.properties','.gradle']);
const textNames=new Set(['.editorconfig','.gitignore','.gitattributes','.ignore','makefile','dockerfile']);
for(const extension of ['.tsx','.jsx','.mts','.cts','.mjs','.cjs','.py','.sh','.bash','.bat','.cmd','.html','.css','.scss','.sass','.svg','.sql','.rs','.go','.kt','.swift','.lua','.gd']) textExtensions.add(extension);
const typeNodes = ['class_declaration','interface_declaration','struct_declaration','record_declaration','enum_declaration'];
let parserPromise: Promise<Parser> | undefined;
async function csharpParser() {
  parserPromise ??= (async () => {
    await Parser.init();
    const language = await Language.load(require.resolve('tree-sitter-wasm/c_sharp/tree-sitter-c_sharp.wasm'));
    const parser = new Parser(); parser.setLanguage(language); return parser;
  })();
  return parserPromise;
}
function qualifiedName(node: SyntaxNode, fileNamespace: string) {
  const names: string[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'namespace_declaration' || typeNodes.includes(parent.type)) {
      const name = parent.childForFieldName('name')?.text; if (name) names.unshift(name);
    }
  }
  return [fileNamespace, ...names].filter(Boolean).join('.');
}
export async function parseCSharp(source: string, file: string) {
  const parser = await csharpParser(); const tree = parser.parse(source);
  if (!tree) throw new Error('tree-sitter returned no tree');
  try {
    const root = tree.rootNode;
    const fileNamespace = root.namedChildren.find(n => n.type === 'file_scoped_namespace_declaration')?.childForFieldName('name')?.text ?? '';
    const declarations = root.descendantsOfType([...typeNodes, 'method_declaration', 'constructor_declaration']);
    const symbols: SourceSymbol[] = declarations.map(node => {
      const name = node.childForFieldName('name')?.text ?? '';
      const namespace = qualifiedName(node, fileNamespace);
      const bases = node.namedChildren.find(n => n.type === 'base_list')?.namedChildren.map(n => n.text) ?? [];
      const line = node.startPosition.row + 1;
      return { id: `${file}#${namespace}.${name}:${line}`, name, kind: node.type.replace('_declaration',''), file, line,
        endLine: node.endPosition.row + 1, namespace, bases };
    }).filter(symbol => symbol.name);
    const usings = root.descendantsOfType('using_directive').map(node => node.text.replace(/^using\s+(?:static\s+)?/, '').replace(/;$/, '').trim());
    const testNames = declarations.filter(node => node.type === 'method_declaration' &&
      node.namedChildren.some(child => child.type === 'attribute_list' && /\b(?:Test|TestCase|UnityTest)\b/.test(child.text)))
      .map(node => [qualifiedName(node, fileNamespace), node.childForFieldName('name')?.text].filter(Boolean).join('.'));
    return { symbols, usings, testNames, parseErrors: root.descendantsOfType('ERROR').length + (root.hasError ? 1 : 0) };
  } finally { tree.delete(); }
}
function kindOf(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.cs') return 'csharp';
  if (['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs'].includes(ext)) return 'typescript';
  if (ext === '.asmdef') return 'assembly';
  if (ext === '.asmref') return 'assembly-ref';
  if (ext === '.meta') return 'unity-meta';
  if (['.unity','.prefab','.asset'].includes(ext)) return 'unity-asset';
  if (ext === '.md') return 'documentation';
  return textExtensions.has(ext) || textNames.has(path.basename(file).toLowerCase()) ? 'source-or-config' : 'binary';
}
export async function inventory(config: ToolkitConfig) {
  const output: FileRecord[] = [];
  const excluded = new Set(config.scan.exclude.map(value => value.toLowerCase()));
  async function walk(directory: string) {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name,'en'));
    for (const entry of entries) {
      const full = path.join(directory, entry.name); const relative = slash(path.relative(config.project, full));
      const extension = path.extname(entry.name).toLowerCase();
      const isSecret = /^\.env(?:\.|$)|^(?:credentials|secrets|auth)\.(?:json|ya?ml|toml)$/i.test(entry.name) || ['.pem','.pfx','.key','.keystore','.jks'].includes(extension);
      if (entry.isSymbolicLink() || excluded.has(entry.name.toLowerCase()) || full === config.workspace || inside(config.workspace, full) || isSecret) {
        output.push({ path: relative + (entry.isDirectory() ? '/' : ''), bytes: 0, kind: 'excluded', status: 'excluded',
          reason: entry.isSymbolicLink() ? 'symlink; not followed' : isSecret ? 'credential file' : 'configured cache/output exclusion' });
      } else if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full); const kind = kindOf(relative);
          if (stat.size > config.scan.maxFileBytes || kind === 'binary')
            output.push({ path: relative, bytes: stat.size, kind, status: 'metadata', hash: hash(`${stat.size}:${stat.mtimeMs}`),
              reason: stat.size > config.scan.maxFileBytes ? 'larger than maxFileBytes; metadata only' : 'binary; metadata only' });
          else output.push({ path: relative, bytes: stat.size, kind, status: 'read' });
        } catch (error) { output.push({ path: relative, bytes: 0, kind: 'unknown', status: 'error', reason: errorMessage(error) }); }
      }
    }
  }
  await walk(config.project); return output;
}
export async function scan(config: ToolkitConfig): Promise<ProjectGraph> {
  const graphPath = safePath(config.workspace, 'graph.json');
  const previous = await exists(graphPath) ? await readJson<ProjectGraph>(graphPath) : undefined;
  const old = new Map(previous?.project === config.project ? previous.files.map(file => [file.path, file]) : []);
  const files = await inventory(config); const assemblies: AssemblyRecord[] = [];
  const asmrefs: { path: string; reference: string }[] = [];
  let reused = 0;
  for (const file of files) {
    if (file.status !== 'read') continue;
    try {
      const data = await fs.readFile(path.join(config.project, file.path)); file.hash = hash(data); const text = data.toString('utf8');
      if (file.kind === 'csharp') {
        const cached = old.get(file.path);
        if (cached?.hash === file.hash && cached.symbols && previous?.parser === 'csharp-wasm/1.1.6+typescript/6.0.3') {
          Object.assign(file, { symbols: cached.symbols, usings: cached.usings, testNames: cached.testNames, parseErrors: cached.parseErrors }); reused++;
        } else Object.assign(file, await parseCSharp(text, file.path));
        file.status = 'parsed';
      }
      if(file.kind==='typescript') {
        const cached=old.get(file.path);
        if(cached?.hash===file.hash && cached.symbols && previous?.parser==='csharp-wasm/1.1.6+typescript/6.0.3') {
          Object.assign(file,{symbols:cached.symbols,imports:cached.imports,testNames:cached.testNames,parseErrors:cached.parseErrors});
        } else Object.assign(file,parseTypeScript(text,file.path));
        file.status='parsed';
        file.assembly=path.posix.dirname(file.path)==='.'?'root':path.posix.dirname(file.path);
      }
      if (file.kind === 'unity-meta') file.guid = /^guid:\s*([a-f0-9]{32})/mi.exec(text)?.[1];
      if (file.kind === 'unity-asset') file.guidRefs = [...new Set([...text.matchAll(/\bguid:\s*([a-f0-9]{32})/gi)].map(match => match[1]).filter(guid => !/^0+$/.test(guid)))];
      if (file.kind === 'assembly') {
        const input = JSON.parse(text);
        if (typeof input.name !== 'string') throw new Error('asmdef has no name');
        assemblies.push({ name: input.name, path: file.path, references: input.references ?? [],
          noEngineReferences: input.noEngineReferences === true, includePlatforms: input.includePlatforms ?? [] });
      }
      if (file.kind === 'assembly-ref') asmrefs.push({ path: file.path, reference: JSON.parse(text).reference });
    } catch (error) { file.status = 'error'; file.reason = errorMessage(error); }
  }
  const metadata = new Map(files.filter(file => file.guid).map(file => [file.path.replace(/\.meta$/, ''), file.guid!]));
  const guidPaths = new Map([...metadata.entries()].map(([file,guid]) => [guid,file]));
  for (const assembly of assemblies) assembly.guid = metadata.get(assembly.path);
  const guidAssemblies = new Map(assemblies.filter(assembly => assembly.guid).map(assembly => [assembly.guid!, assembly.name]));
  const bindings = assemblies.map(assembly => ({ directory: path.posix.dirname(assembly.path), name: assembly.name }));
  for (const ref of asmrefs) {
    const name = ref.reference?.startsWith('GUID:') ? guidAssemblies.get(ref.reference.slice(5)) : ref.reference;
    if (name) bindings.push({ directory: path.posix.dirname(ref.path), name });
  }
  bindings.sort((a,b) => b.directory.length-a.directory.length);
  for (const file of files) if (file.kind === 'csharp')
    file.assembly = bindings.find(binding => file.path.startsWith(binding.directory + '/'))?.name ?? 'Assembly-CSharp';
  const edges: ProjectGraph['edges'] = [];
  const sourcePaths=new Set(files.filter(file=>file.kind==='typescript').map(file=>file.path));
  let unresolvedImports=0;
  for(const file of files) for(const item of file.imports ?? []) {
    item.target=resolveImport(file.path,item.specifier,sourcePaths);
    if(item.target) edges.push({from:file.path,to:item.target,kind:'import',file:file.path,line:item.line,certainty:'declared'});
    else if(item.specifier.startsWith('.')) unresolvedImports++;
  }
  for (const assembly of assemblies) for (const raw of assembly.references) {
    const reference = raw.startsWith('GUID:') ? guidAssemblies.get(raw.slice(5)) ?? raw : raw;
    edges.push({ from: assembly.name, to: reference, kind: 'assembly-reference', file: assembly.path, certainty: 'declared' });
  }
  let unresolvedAssetReferences = 0;
  for (const file of files) for (const guid of file.guidRefs ?? []) {
    const target = guidPaths.get(guid);
    if (target) edges.push({ from: file.path, to: target, kind: 'asset-reference', file: file.path, certainty: 'declared' });
    else unresolvedAssetReferences++;
  }
  const declarations = files.flatMap(file => file.symbols ?? []).filter(symbol => typeNodes.some(kind => kind.startsWith(symbol.kind + '_')));
  const typesByName=new Map<string,SourceSymbol[]>();
  for(const declaration of declarations) {const bucket=typesByName.get(declaration.name) ?? [];bucket.push(declaration);typesByName.set(declaration.name,bucket);}
  for (const symbol of declarations) for (const base of symbol.bases) {
    const name = base.replace(/<.*>/,'').split('.').at(-1);
    const candidates = (typesByName.get(name ?? '') ?? []).filter(candidate => candidate.id !== symbol.id);
    if (candidates.length === 1) edges.push({ from: symbol.id, to: candidates[0].id, kind: 'inherits', file: symbol.file, line: symbol.line, certainty: 'name-match' });
  }
  const changedFiles = files.filter(file => file.hash && old.get(file.path)?.hash !== file.hash).map(file => file.path);
  const paths=new Set(files.map(file=>file.path));
  for (const file of old.keys()) if (!paths.has(file)) changedFiles.push(file);
  const hashed = files.filter(file => file.hash).sort((a,b) => a.path.localeCompare(b.path,'en')).map(file => `${file.path}\0${file.hash}`);
  const graph: ProjectGraph = { schemaVersion: 1, project: config.project, generatedAt: now(), sourceHash: hash(hashed.join('\n')),
    parser: 'csharp-wasm/1.1.6+typescript/6.0.3', files, assemblies, edges, changedFiles: changedFiles.sort(), counts: {
      inventoried: files.length, parsedCSharp: files.filter(file => file.kind==='csharp' && file.status === 'parsed').length,
      parsedTypeScript: files.filter(file=>file.kind==='typescript' && file.status==='parsed').length, unresolvedImports,
      reusedCSharp: reused, syntaxWarnings: files.filter(file => (file.parseErrors ?? 0) > 0).length,
      read: files.filter(file => file.status === 'read').length, metadataOnly: files.filter(file => file.status === 'metadata').length,
      excludedEntries: files.filter(file => file.status === 'excluded').length, errors: files.filter(file => file.status === 'error').length,
      symbols: files.reduce((total,file) => total + (file.symbols?.length ?? 0),0), unresolvedAssetReferences
    } };
  await writeJson(graphPath, graph);
  await writeJson(safePath(config.workspace, 'coverage.json'), { ...graph.counts, sourceHash: graph.sourceHash,
    limitations: ['Inherited types are matched by name, not compiler-resolved.', 'Dynamic runtime/DI/event relations are not asserted.', 'Excluded directories are recorded once, not enumerated.', 'C# and TS/JS have syntax parsing; other text is read/hashed.', 'Relative TS/JS imports are resolved locally; package imports, tsconfig aliases and dynamic imports need compiler/runtime review.', 'Binary/oversize assets use size/mtime metadata.'],
    excluded: files.filter(file => file.status === 'excluded' || file.status === 'error' || file.status === 'metadata'),
    syntaxWarningFiles: files.filter(file => (file.parseErrors ?? 0) > 0).map(file => file.path) });
  return graph;
}
