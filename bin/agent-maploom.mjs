#!/usr/bin/env node
import { existsSync } from 'node:fs';
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('AgentMaploom requires Node.js 24 or newer. Use bootstrap.ps1 on Windows.');
  process.exitCode = 2;
} else {
  const compiled=new URL('../lib/cli.js',import.meta.url);
  await import(existsSync(compiled)?compiled.href:new URL('../src/cli.ts',import.meta.url).href);
}
