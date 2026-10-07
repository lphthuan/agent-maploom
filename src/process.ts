import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { errorMessage, redact } from './io.ts';

export async function runProcess(executable: string, args: string[], options: { cwd: string; timeoutMs: number; log: string; stdoutFile?: string; env?: NodeJS.ProcessEnv }) {
  if (/\.(?:bat|cmd)$/i.test(executable)) throw new Error('Use the Node entrypoint or pwsh executable instead of a .cmd/.bat shell wrapper');
  await fs.mkdir(path.dirname(options.log), { recursive: true });
  await fs.writeFile(options.log, '');
  if(options.stdoutFile) {await fs.mkdir(path.dirname(options.stdoutFile),{recursive:true});await fs.writeFile(options.stdoutFile,'');}
  const started = Date.now();
  return new Promise<{ exitCode: number | null; timedOut: boolean; durationMs: number; tail: string }>((resolve, reject) => {
    const child = spawn(executable,args,{cwd:options.cwd,env:{...process.env,...options.env},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let timedOut = false; let buffer = ''; let writes = Promise.resolve(); let settled = false;
    const collect = (value: string,stdout=false) => {
      const text = redact(value); buffer = (buffer + text).slice(-6000);
      writes = writes.then(() => fs.appendFile(options.log,text));
      if(stdout && options.stdoutFile) writes=writes.then(()=>fs.appendFile(options.stdoutFile!,text));
    };
    const streams = [child.stdout,child.stderr].map((stream,index) => {
      const decoder = new StringDecoder('utf8');let pending='';let oversized=false;
      const drain = (final=false) => {
        let newline;
        while((newline=pending.indexOf('\n'))>=0) {
          if(!oversized) collect(pending.slice(0,newline+1),index===0);
          pending=pending.slice(newline+1);oversized=false;
        }
        if(pending.length>1024*1024) {collect('[Output line over 1 MiB omitted]\n');pending='';oversized=true;}
        if(final && pending) {if(!oversized) collect(pending,index===0);pending='';}
      };
      stream.on('data',(data:Buffer)=>{pending+=decoder.write(data);drain();});
      return ()=>{pending+=decoder.end();drain(true);};
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const stop = spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
        stop.on('error',() => child.kill());
      } else child.kill('SIGTERM');
    },options.timeoutMs);
    child.once('error',error => { if(!settled) { settled=true;clearTimeout(timer);reject(new Error(`Cannot start ${executable}: ${errorMessage(error)}`)); } });
    child.once('close',async exitCode => {
      if(settled) return;settled=true;clearTimeout(timer);
      for(const flush of streams) flush();
      try { await writes;resolve({exitCode,timedOut,durationMs:Date.now()-started,tail:buffer}); } catch(error) {reject(error);}
    });
  });
}
