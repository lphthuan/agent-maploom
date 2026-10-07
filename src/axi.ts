import { encode } from '@toon-format/toon';
import { sanitize } from './io.ts';

export function compact(value:any):any {
  if(value===null || typeof value!=='object') return typeof value==='string'&&value.length>900?value.slice(0,900)+'…':value;
  if(Array.isArray(value)) return value.length>12?{count:value.length,items:value.slice(0,12).map(compact),truncated:true,help:['Use --full for all items']} : value.map(compact);
  const result:Record<string,unknown>={};
  for(const [key,item] of Object.entries(value)) {
    if(['files','symbols','edges','packages','state','steps','instructions','output','changedFiles'].includes(key)) {
      if(Array.isArray(item)){result[key+'Count']=item.length;if(key==='steps') result[key]=item.slice(0,8).map((s:any)=>({tool:s.tool,version:s.version,action:s.action}));}
      else if(key==='state' && item) {const s=item as any;result.task={id:s.id,goal:s.goal,next:s.next};}
      else if(key==='output' && typeof item==='string') result.output=item.slice(0,3500);
      else result[key]=compact(item);
    } else if(key==='checks' && Array.isArray(item)) result.checks=item.slice(0,12).map((c:any)=>({id:c.id,status:c.status,executed:c.executedTests ?? null,details:String(c.details ?? '').slice(0,400)}));
    else if(key==='results' && Array.isArray(item)) result.results=item.slice(0,12).map((r:any)=>({tool:r.tool,version:r.version,status:r.status,log:r.log}));
    else result[key]=compact(item);
  }
  return result;
}
export function renderAxi(value:unknown,json=false,full=false) {
  const safe=sanitize(value);
  return json?JSON.stringify(safe,null,2):encode(full?safe:compact(safe));
}
