import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const workspace=path.resolve(process.argv[2] ?? '.agentkit');
const entry=path.join(workspace,'tools','memory','node_modules','@modelcontextprotocol','server-memory','dist','index.js');
const require=createRequire(await fs.realpath(entry));
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const store=path.join(workspace,'qa','memory-smoke.jsonl');await fs.mkdir(path.dirname(store),{recursive:true});
const clientFor=async()=>{
  const client=new Client({name:'agent-maploom-memory-check',version:'0.2.0'},{capabilities:{}});
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  await client.connect(new StdioClientTransport({command:process.execPath,args:[entry],env:{...env,MEMORY_FILE_PATH:store}}));
  return client;
};
const first=await clientFor();let tools;
try {
  tools=(await first.listTools()).tools.map((tool:{name:string})=>tool.name);
  await first.callTool({name:'create_entities',arguments:{entities:[{name:'agentkit-persistence-check',entityType:'verification',observations:['Stored locally and retrieved after process restart.']}]}});
} finally {await first.close();}
const second=await clientFor();let restored=false;
try {
  const response=await second.callTool({name:'open_nodes',arguments:{names:['agentkit-persistence-check']}});
  restored=JSON.stringify(response).includes('Stored locally and retrieved after process restart.');
} finally {await second.close();}
const report={status:restored?'passed':'failed',toolCount:tools.length,restoredAfterRestart:restored,store};
await fs.writeFile(path.join(workspace,'qa','memory-smoke-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!restored) process.exitCode=1;
