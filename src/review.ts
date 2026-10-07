import path from 'node:path';
import { promises as fs } from 'node:fs';
import { atomicWrite, exists, inside, safePath } from './io.ts';
import { toolEntrypoint } from './setup.ts';
import { runProcess } from './process.ts';
import type { ToolkitConfig } from './types.ts';

const escape=(value:unknown)=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function writeSetupPage(config:ToolkitConfig,result:any) {
  const target=safePath(config.workspace,'docs','SETUP.html');
  const rows=(result.helpers?.results ?? []).map((item:any)=>`<tr><td>${escape(item.tool)}</td><td>${escape(item.version)}</td><td>${escape(item.status)}</td></tr>`).join('');
  await atomicWrite(target,`<!doctype html><html lang="vi" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AgentMaploom — ${escape(path.basename(config.project))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css"><script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>
<style>html,body{background:#f6f7fb;color:#172033}body{font-family:system-ui,sans-serif;margin:0}main{max-width:960px;margin:auto;padding:32px}p,td,th,code{overflow-wrap:anywhere}table{width:100%}th,td{text-align:left;padding:12px}section{margin-block:24px}pre{white-space:pre-wrap}*{box-sizing:border-box}</style></head><body><main>
<p class="text-sm font-semibold">AGENTMAPLOOM / SETUP</p><h1 class="text-3xl font-bold">${escape(path.basename(config.project))}</h1>
<p class="mt-3">Trạng thái setup: <strong>${escape(result.status)}</strong>. Agent bắt đầu từ AGENTS.md, đọc sơ đồ và truy xuất phần liên quan trước khi chỉnh sửa.</p>
<section class="card card-border bg-base-100"><div class="card-body"><h2 class="card-title">Các thành phần đã cài</h2><div class="overflow-x-auto"><table class="table table-zebra"><thead><tr><th>Tool</th><th>Phiên bản</th><th>Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>
<section><h2 class="text-xl font-semibold">Đường dẫn làm việc</h2><p>${escape(config.project)}</p><p>Workspace: ${escape(config.workspace)}</p><p>Profile: ${escape(config.profile)}</p></section>
<section><h2 class="text-xl font-semibold">Luồng mỗi thay đổi</h2><ol class="list-decimal pl-6"><li>AGENTS.md → SYSTEM_MAP.md và CURRENT.md.</li><li>task/context với yêu cầu của người dùng → mã nguồn, phụ thuộc và quyết định liên quan.</li><li>Phát triển → verify basic hoặc full → checkpoint và handoff.</li></ol></section>
<section><h2 class="text-xl font-semibold">Kiểm thử</h2><p>Basic: test liên quan và check bắt buộc. Full: suite cấu hình và No-mistakes. Native No-mistakes cần Git/commit/feature branch, gate và agent CLI đã đăng nhập; thiếu điều kiện sẽ báo blocked. Cài tool không đồng nghĩa game đã được kiểm thử.</p></section>
<section><h2 class="text-xl font-semibold">Bắt đầu</h2><pre><code>node "${escape(path.join(config.workspace,'agentkit.mjs'))}" task --task feature-1 --goal "Yêu cầu cần phát triển"
node "${escape(path.join(config.workspace,'agentkit.mjs'))}" context "từ khóa"
node "${escape(path.join(config.workspace,'agentkit.mjs'))}" review poll</code></pre><p>Phản hồi Lavish được lưu ở máy. Chỉ có Agent đang chạy poll mới nhận phản hồi; trang này không tự khởi chạy model hay giám sát nền.</p></section>
<details><summary>Điều kiện và bằng chứng setup</summary><pre>${escape(JSON.stringify(result,null,2))}</pre></details>
<p class="text-sm mt-6">Giao diện dùng DaisyUI/Tailwind theo hướng dẫn Lavish; CDN chỉ dùng cho trình bày. Nội dung vẫn đọc được khi không có mạng.</p></main></body></html>`);
  return target;
}
export async function review(config:ToolkitConfig,action:string,file?:string,message?:string,noOpen=false) {
  const entry=toolEntrypoint(config,'lavish');if(!await exists(entry)) throw new Error('Lavish is not installed; run setup --apply');
  const target=path.resolve(config.workspace,file ?? 'docs/SETUP.html');
  if(action!=='playbook' && action!=='stop') {
    if(!inside(config.workspace,target) || !/\.html$/i.test(target)) throw new Error('Review HTML must be inside the project workspace');
    if(!await exists(target)) throw new Error(`Review artifact missing: ${target}`);
    if(!inside(await fs.realpath(config.workspace),await fs.realpath(target))) throw new Error('Review artifact symlink escapes workspace');
  }
  let args:string[];
  if(action==='open') args=[target,...noOpen?['--no-open']:[]];
  else if(action==='poll') args=['poll',target];
  else if(action==='reply') {if(!message?.trim()) throw new Error('review reply requires a message');args=['reply',target,'--agent-reply',message];}
  else if(action==='stop') args=['stop'];
  else if(action==='playbook') {if(!['plan','table','comparison','code','diagram','input','explanation','slides'].includes(message ?? '')) throw new Error('Choose a supported Lavish playbook');args=['playbook',message!];}
  else throw new Error('review supports open, poll, reply, stop, playbook');
  const log=safePath(config.workspace,'lavish',`${action}.log`),stdoutFile=safePath(config.workspace,'lavish',`${action}-${Date.now()}.toon`);
  const result=await runProcess(process.execPath,[entry,...args],{cwd:config.workspace,timeoutMs:action==='poll'?3600000:45000,log,stdoutFile,
    env:{LAVISH_AXI_STATE_DIR:safePath(config.workspace,'lavish'),DO_NOT_TRACK:'1'}});
  const output=await fs.readFile(stdoutFile,'utf8');
  return {status:result.exitCode===0?'ready':'failed',action,artifact:action==='stop'||action==='playbook'?undefined:target,log,outputFile:stdoutFile,
    output:output.slice(0,config.context.maxChars),truncated:output.length>config.context.maxChars,
    note:action==='poll'?'Feedback was consumed by this poll and saved in outputFile; read the complete file before acting or replying.':undefined};
}
