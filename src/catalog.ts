import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import rawCatalog from "./api-catalog.json";
import type { ApiRoot, openApiRequest } from "./transport";
export interface Endpoint {
  id: string; root: ApiRoot; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; description: string; parameters: Record<string, {location?: string; required?: boolean; type?: string}>;
  requestBody: unknown; scopes: string[] | null; accessTokens: string[] | null; documentation: string; source: string;
}
export const catalog = rawCatalog as Endpoint[];
export function buildEndpointRequest(id: string, parameters: Record<string, unknown> = {}) {
  const endpoint = catalog.find(e => e.id === id);
  if (!endpoint) throw new Error(`Unknown endpoint: ${id}. Use search_feishu_api first.`);
  if (endpoint.accessTokens?.length && !endpoint.accessTokens.includes("tenant")) {
    throw new Error("This endpoint requires user OAuth; this server uses tenant credentials.");
  }
  let path = endpoint.path;
  for (const name of path.matchAll(/\{(\w+)\}/g)) {
    const value = parameters[name[1]];
    if (typeof value !== "string" || !value || /[/?#\\%]/.test(value) || value === "." || value === "..") {
      throw new Error(`Invalid or missing path parameter: ${name[1]}`);
    }
    path = path.replace(name[0], encodeURIComponent(value));
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (endpoint.parameters[key]?.location === "path") continue;
    if (endpoint.source !== "larksuite/node-sdk" && (!endpoint.parameters[key] || endpoint.parameters[key].location !== "query")) throw new Error(`Unknown query parameter: ${key}; use the generic domain tool for newer API fields.`);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!["string", "number", "boolean"].includes(typeof item)) throw new Error(`Invalid query parameter: ${key}`);
      query.append(key, String(item));
    }
  }
  for (const [key, spec] of Object.entries(endpoint.parameters)) {
    if (spec.required && parameters[key] === undefined) throw new Error(`Missing parameter: ${key}`);
  }
  return { endpoint, path: path + (query.size ? `?${query}` : "") };
}
type Invoke = (...args: Parameters<typeof openApiRequest> extends [unknown, ...infer Rest] ? Rest : never) => Promise<unknown>;
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
export function registerCatalog(server: McpServer, invoke: Invoke) {
  server.registerTool("search_feishu_api", {
    description: "Find documented document APIs by domain, scope, endpoint ID or keyword. Metadata comes from official Lark CLI/SDK. Null scopes/token metadata means unknown, not unrestricted. Use endpoint_id to retrieve the complete request schema; catalog presence is not a live permission test.",
    inputSchema: { query: z.string().optional().default(""), endpoint_id: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) },
  }, async ({query,endpoint_id,offset,limit}) => {
    if (endpoint_id) return result({endpoint: catalog.find(e => e.id === endpoint_id) ?? null});
    const matches = catalog.filter(e => [e.id,e.root,e.path,e.description,...(e.scopes??[])].join(" ").toLowerCase().includes(query.toLowerCase()));
    return result({total: matches.length, next_offset: offset+limit < matches.length ? offset+limit : null, endpoints: matches.slice(offset,offset+limit).map(({parameters,requestBody,...e})=>e)});
  });
  server.registerTool("call_feishu_api", {
    description: "Invoke an endpoint discovered with search_feishu_api. Fill its path/query parameters and documented JSON body or multipart upload. User-only endpoints are rejected. Destructive calls must target an explicitly authorized resource. Each invocation performs one request; follow returned pagination/task IDs explicitly.",
    inputSchema: { endpoint_id: z.string(), parameters: z.record(z.string(),z.unknown()).optional(), body: z.unknown().optional(), upload: z.object({field:z.string().min(1),filename:z.string().min(1),content_type:z.string().min(1),base64:z.string().min(1),fields:z.record(z.string(),z.string()).optional()}).optional() },
  }, async ({endpoint_id,parameters,body,upload}) => {
    try { const {endpoint:e,path}=buildEndpointRequest(endpoint_id,parameters); return result(await invoke(e.root,e.method,path,body,upload)); }
    catch(error) { return {...result(error instanceof Error ? error.message : String(error)),isError:true}; }
  });
}
