import { errorMessage } from './io.ts';

type Rpc = { jsonrpc: string; id?: number; result?: unknown; error?: { message: string } };
export function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function unwrapMcp(value: unknown): any {
  const input = object(value);
  if (input.structuredContent) return input.structuredContent;
  const blocks = input.contents ?? input.content;
  if (Array.isArray(blocks)) {
    const json = blocks.map(item => item.text ?? item.resource?.text).filter((text): text is string => typeof text === 'string');
    for (const text of json) try { return JSON.parse(text); } catch { /* A block may be plain text. */ }
    return { text: json.join('\n'), isError: input.isError === true };
  }
  return value;
}
export class HttpMcpClient {
  url: string; timeoutMs: number; session?: string; protocolVersion?: string; nextId = 1; connected = false;
  constructor(url: string, timeoutMs: number) { this.url=url;this.timeoutMs=timeoutMs; }
  async request(method: string, params?: unknown, notification = false): Promise<any> {
    const id = notification ? undefined : this.nextId++;
    const response = await fetch(this.url,{ method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream',
      ...(this.session ? {'Mcp-Session-Id':this.session} : {}),
      ...(this.protocolVersion ? {'MCP-Protocol-Version':this.protocolVersion} : {})},
      body:JSON.stringify({jsonrpc:'2.0',...(id === undefined ? {} : {id}),method,...(params === undefined ? {} : {params})}),
      signal:AbortSignal.timeout(this.timeoutMs) });
    if(!response.ok) throw new Error(`MCP ${method}: HTTP ${response.status}`);
    this.session = response.headers.get('mcp-session-id') ?? this.session;
    if(notification || response.status === 202 || response.status === 204) return undefined;
    const text=await response.text();let messages: Rpc[];
    if(response.headers.get('content-type')?.includes('text/event-stream'))
      messages=text.split(/\r?\n\r?\n/).map(block=>block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(payload=>JSON.parse(payload));
    else messages=[JSON.parse(text)];
    const message=messages.find(item=>item.id===id);
    if(!message) throw new Error(`MCP ${method}: no matching response`);
    if(message.error) throw new Error(message.error.message);
    return message.result;
  }
  async connect() {
    if(this.connected) return;
    const initialized=object(await this.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'agent-maploom',version:'0.2.0'}}));
    this.protocolVersion=initialized.protocolVersion ?? '2025-03-26';
    await this.request('notifications/initialized',{},true);this.connected=true;
  }
  async resources() { await this.connect();return object(await this.request('resources/list')).resources as {uri:string;name:string}[] ?? []; }
  async resource(uri: string) { await this.connect();return unwrapMcp(await this.request('resources/read',{uri})); }
  async tools() { await this.connect();return object(await this.request('tools/list')).tools as {name:string;inputSchema:Record<string,any>}[] ?? []; }
  async tool(name: string, args: Record<string,unknown>) {
    await this.connect();const raw=await this.request('tools/call',{name,arguments:args});
    if(object(raw).isError) throw new Error(object(unwrapMcp(raw)).text ?? `MCP tool ${name} failed`);
    const value=unwrapMcp(raw);
    if(object(value).success===false) throw new Error(object(value).error ?? object(value).message ?? `${name} failed`);
    return value;
  }
  async close() {
    if(this.session) try { await fetch(this.url,{method:'DELETE',headers:{'Mcp-Session-Id':this.session},signal:AbortSignal.timeout(2000)}); } catch { /* Connection may already be closed. */ }
  }
}
export function connectionError(error: unknown) {
  const cause=object(error).cause;
  const code=object(cause).code;
  return `${errorMessage(error)}${code ? ` (${code})` : ''}`;
}
