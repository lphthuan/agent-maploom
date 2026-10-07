import ts from 'typescript';
import path from 'node:path';
import type { SourceSymbol } from './types.ts';

export function parseTypeScript(text:string,file:string) {
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,/\.(?:tsx|jsx)$/.test(file)?ts.ScriptKind.TSX:/\.(?:js|mjs|cjs)$/.test(file)?ts.ScriptKind.JS:ts.ScriptKind.TS);
  const symbols:SourceSymbol[]=[];const imports:{specifier:string;line:number;target?:string}[]=[];const testNames:string[]=[];
  const line=(node:ts.Node)=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  function visit(node:ts.Node,scope:string[]) {
    let name:string|undefined,kind:string|undefined;
    if(ts.isFunctionDeclaration(node)){name=node.name?.text;kind='function';}
    else if(ts.isClassDeclaration(node)){name=node.name?.text;kind='class';}
    else if(ts.isInterfaceDeclaration(node)){name=node.name.text;kind='interface';}
    else if(ts.isTypeAliasDeclaration(node)){name=node.name.text;kind='type';}
    else if(ts.isEnumDeclaration(node)){name=node.name.text;kind='enum';}
    else if(ts.isMethodDeclaration(node)){name=node.name.getText(source);kind='method';}
    else if(ts.isVariableDeclaration(node) && (node.initializer && (ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))){name=node.name.getText(source);kind='function';}
    if(name && kind) symbols.push({id:`${file}#${[...scope,name].join('.')}:${line(node)}`,name,kind,file,line:line(node),endLine:source.getLineAndCharacterOfPosition(node.end).line+1,namespace:scope.join('.'),bases:[]});
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      imports.push({specifier:node.moduleSpecifier.text,line:line(node)});
    if(ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && /^(?:test|it|describe)(?:\.(?:skip|only|todo))?$/.test(node.expression.getText(source)))
      testNames.push(node.arguments[0].text);
    ts.forEachChild(node,child=>visit(child,name && ['class','interface'].includes(kind ?? '')?[...scope,name]:scope));
  }
  visit(source,[]);
  const diagnostics=(source as ts.SourceFile & {parseDiagnostics:ts.Diagnostic[]}).parseDiagnostics;
  return {symbols,imports,testNames,parseErrors:diagnostics.length};
}

export function resolveImport(file:string,specifier:string,known:Set<string>) {
  if(!specifier.startsWith('.')) return undefined; // aliases/packages require compiler resolution
  const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier));
  const stem=base.replace(/\.(?:m?js|cjs)$/,'');
  return [base,...['.ts','.tsx','.js','.jsx','.mjs','.mts','.cts'].map(ext=>stem+ext),...['.ts','.tsx','.js','.mjs'].map(ext=>base+'/index'+ext)].find(candidate=>known.has(candidate));
}
