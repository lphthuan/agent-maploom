import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const slash = (value: string) => value.replaceAll('\\', '/');
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
export async function readJson<T>(file: string): Promise<T> { return JSON.parse(await fs.readFile(file, 'utf8')); }
export function inside(root: string, candidate: string) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function safePath(root: string, ...segments: string[]) {
  const resolved = path.resolve(root, ...segments);
  if (!inside(root, resolved)) throw new Error(`Path escapes workspace: ${segments.join('/')}`);
  return resolved;
}
export async function atomicWrite(file: string, contents: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, contents, 'utf8'); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
export async function writeJson(file: string, value: unknown) { await atomicWrite(file, JSON.stringify(sanitize(value), null, 2) + '\n'); }
export async function withLock<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  await fs.mkdir(workspace, { recursive: true });
  const lockPath = safePath(workspace, 'writer.lock');
  let handle;
  try { handle = await fs.open(lockPath, 'wx'); }
  catch { throw new Error(`Workspace is locked. Inspect ${lockPath}; remove only after the writer has stopped.`); }
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: now() }));
  try { return await action(); }
  finally { await handle.close(); await fs.rm(lockPath, { force: true }); }
}
export function redact(text: string) {
  return text
    .replace(/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;"'}]+)/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
}
export function sanitize(value: unknown): unknown {
  if(typeof value==='string') return redact(value);
  if(Array.isArray(value)) return value.map(sanitize);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)$/i.test(key) ? '[REDACTED]' : sanitize(item)]));
  return value;
}
export function markdownLink(label: string, file: string, line?: number) {
  const target = slash(path.resolve(file)) + (line ? `:${line}` : '');
  return `[${label.replaceAll('[', '\\[').replaceAll(']', '\\]')}](<${target}>)`;
}
export function md(value: string) { return value.replaceAll('|', '\\|').replaceAll('\n', ' '); }
export async function appendJournal(workspace: string, event: Record<string, unknown>) {
  const target = safePath(workspace, 'journal.jsonl');
  await fs.mkdir(workspace, { recursive: true });
  if (await exists(target)) {
    const content = await fs.readFile(target, 'utf8');
    if (content && !content.endsWith('\n')) {
      const boundary = content.lastIndexOf('\n') + 1;
      const tail = content.slice(boundary);
      let complete = false;
      try { JSON.parse(tail); complete = true; } catch { /* Interrupted append. */ }
      if (complete) await fs.appendFile(target, '\n');
      else {
        const recovery = safePath(workspace, 'recovery', `journal-tail-${randomUUID()}.txt`);
        await atomicWrite(recovery, redact(tail));
        await atomicWrite(target, content.slice(0, boundary));
        await fs.appendFile(target, JSON.stringify({at:now(),event:'journal-tail-recovered',recovery}) + '\n');
      }
    }
  }
  await fs.appendFile(target, JSON.stringify(sanitize({ at: now(), ...event })) + '\n');
}
