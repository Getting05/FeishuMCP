import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readLimited } from "./transport";
export interface EventEnv {
  FEISHU_VERIFICATION_TOKEN?: string;
  FEISHU_ENCRYPT_KEY?: string;
  FEISHU_APP_ID?: string;
  FEISHU_EVENTS?: DurableObjectNamespace;
}
const encoder = new TextEncoder();
async function digest(text: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(text))); }
function equal(a: string,b: string) { const aa=encoder.encode(a),bb=encoder.encode(b); let diff=aa.length^bb.length; for(let i=0;i<Math.max(aa.length,bb.length);i++) diff|=(aa[i]??0)^(bb[i]??0); return diff===0; }
export async function verifyEvent(request: Request,env: EventEnv) {
  if(!env.FEISHU_VERIFICATION_TOKEN) throw new Error("Event verification is not configured.");
  const raw=new TextDecoder().decode(await readLimited(request,1024*1024));
  let payload=JSON.parse(raw);
  if(env.FEISHU_ENCRYPT_KEY) {
    if(typeof payload.encrypt!=="string") throw new Error("Encrypted event required.");
    const bytes=Uint8Array.from(atob(payload.encrypt),(c)=>c.charCodeAt(0));
    if(bytes.length<32||bytes.length%16!==0) throw new Error("Invalid ciphertext.");
    const key=await crypto.subtle.importKey("raw",await digest(env.FEISHU_ENCRYPT_KEY),"AES-CBC",false,["decrypt"]);
    payload=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-CBC",iv:bytes.slice(0,16)},key,bytes.slice(16))));
  }
  if(!equal(String(payload.header?.token??payload.token??""),env.FEISHU_VERIFICATION_TOKEN)) throw new Error("Invalid verification token.");
  if(payload.type==="url_verification") {
    if(typeof payload.challenge!=="string") throw new Error("Missing challenge.");
    return {challenge:payload.challenge};
  }
  if(env.FEISHU_ENCRYPT_KEY) {
    const timestamp=request.headers.get("x-lark-request-timestamp")??"";
    const nonce=request.headers.get("x-lark-request-nonce")??"";
    if(!/^\d+$/.test(timestamp)||!nonce||Math.abs(Date.now()/1000-Number(timestamp))>300) throw new Error("Expired or missing event signature.");
    const expected=Array.from(await digest(timestamp+nonce+env.FEISHU_ENCRYPT_KEY+raw),b=>b.toString(16).padStart(2,"0")).join("");
    if(!equal(expected,request.headers.get("x-lark-signature")??"")) throw new Error("Invalid event signature.");
  }
  const appId=payload.header?.app_id??payload.event?.app_id;
  if(appId && env.FEISHU_APP_ID && appId!==env.FEISHU_APP_ID) throw new Error("Unexpected event app.");
  const event_id=payload.header?.event_id??payload.uuid;
  const event_type=payload.header?.event_type??payload.event?.type;
  if(typeof event_id!=="string"||!event_id||event_id.length>256||typeof event_type!=="string") throw new Error("Missing event identity.");
  // Credentials from the envelope must not be returned through MCP.
  delete payload.token; if(payload.header) delete payload.header.token;
  return {event_id,event_type,received_at:new Date().toISOString(),payload};
}
function store(env:EventEnv) {
  if(!env.FEISHU_EVENTS) throw new Error("FEISHU_EVENTS Durable Object binding is required.");
  return env.FEISHU_EVENTS.get(env.FEISHU_EVENTS.idFromName("document-events"));
}
export async function handleEvent(request:Request,env:EventEnv) {
  if(request.method!=="POST") return new Response("Method not allowed",{status:405,headers:{Allow:"POST"}});
  if(!env.FEISHU_VERIFICATION_TOKEN||!env.FEISHU_EVENTS) return new Response("Event receiver is not configured",{status:503});
  let event: Awaited<ReturnType<typeof verifyEvent>>;
  try { event=await verifyEvent(request,env); }
  catch { return new Response("Invalid event",{status:400}); }
  if("challenge" in event) return Response.json(event);
  try {
    const response=await store(env).fetch("https://events/ingest",{method:"POST",body:JSON.stringify(event)});
    if(!response.ok) return new Response("Event persistence failed",{status:503});
    return Response.json({});
  } catch { return new Response("Event persistence failed",{status:503}); }
}
export class FeishuEventStore {
  constructor(private state:DurableObjectState) {}
  async fetch(request:Request) {
    const url=new URL(request.url);
    if(url.pathname==="/ingest" && request.method==="POST") {
      const event=await request.json() as {event_id:string};
      const key=`event:${event.event_id}`;
      await this.state.storage.transaction(async tx=> { if(!(await tx.get(key))) await tx.put(key,event); });
      return Response.json({});
    }
    if(url.pathname==="/list" && request.method==="GET") {
      const limit=Math.max(1,Math.min(100,Number(url.searchParams.get("limit"))||50));
      const after=url.searchParams.get("cursor");
      const entries=await this.state.storage.list({prefix:"event:",limit:limit+1,...(after?{startAfter:`event:${after}`}:{})});
      const page=[...entries.entries()]; const hasMore=page.length>limit; page.splice(limit);
      return Response.json({events:page.map(([,value])=>value),next_cursor:hasMore?page.at(-1)?.[0].slice(6):null});
    }
    return new Response("Not found",{status:404});
  }
}
export function registerEventTools(server:McpServer,env:EventEnv) {
  server.registerTool("list_feishu_events",{description:"Read persisted verified Feishu callback events, deduplicated by event_id. Cursor order is event ID, not chronology. Configure /feishu/events and subscribe in Feishu first. Events are retained until the storage is administratively cleared.",inputSchema:{cursor:z.string().optional(),limit:z.number().int().min(1).max(100).default(50)}},async({cursor,limit})=>{
    try { const q=new URLSearchParams({limit:String(limit)});if(cursor)q.set("cursor",cursor);const response=await store(env).fetch(`https://events/list?${q}`);if(!response.ok)throw new Error("Event store unavailable");return {content:[{type:"text" as const,text:await response.text()}]}; }
    catch(error){return {isError:true,content:[{type:"text" as const,text:error instanceof Error?error.message:String(error)}]};}
  });
}
