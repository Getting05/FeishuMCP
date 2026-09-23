const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
interface FeishuEnvelope<T> { code?: number; msg?: string; data?: T }
// Document families only. Slides XML API lives under slides_ai (official CLI catalog).
export function allowedRoots(root: ApiRoot): string[] {
  return root === "slides" ? ["slides", "slides_ai"] : root === "docs" ? ["docs", "docs_ai"] : [root];
}
export async function readLimited(response: Response | Request, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error(`Payload exceeds ${limit} bytes.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
// Only document-related Feishu APIs are exposed. Never proxy auth or other
// tenant APIs through this endpoint, even if the caller supplies a path.
export const API_ROOTS = [
  "bitable", "board", "docs", "docx", "drive", "mindnote",
  "sheets", "slides", "wiki",
] as const;
export type ApiRoot = (typeof API_ROOTS)[number];
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function checkedPath(path: string, root: ApiRoot): string {
  const pathname = path.split(/[?#]/, 1)[0];
  const searchAlias = root === "drive" && ["/suite/docs-api/search/object", "/search/v2/doc_wiki/search"].includes(pathname);
  if ((!searchAlias && !allowedRoots(root).some((prefix) => pathname.startsWith(`/${prefix}/`))) || pathname.includes("\\") ||
      /%(?:2f|5c|2e|00)/i.test(pathname) || /[\u0000-\u001f]/.test(path)) {
    throw new Error(`Path is outside the allowed ${root} document API routes, or contains traversal.`);
  }
  const url = new URL(path, FEISHU_BASE_URL);
  if (pathname.split("/").some(segment => segment === ".." || segment === ".") ||
      url.origin !== new URL(FEISHU_BASE_URL).origin || url.hash) {
    throw new Error("Invalid Feishu API path.");
  }
  return `${url.pathname}${url.search}`;
}

export function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid or oversized base64 upload (8 MiB maximum).");
  }
  const binary = atob(value);
  if (binary.length > MAX_UPLOAD_BYTES) throw new Error("Upload exceeds 8 MiB.");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function openApiRequest(
  getToken: () => Promise<string>,
  root: ApiRoot,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  upload?: { field: string; filename: string; content_type: string; base64: string; fields?: Record<string, string> },
) {
  const safePath = checkedPath(path, root);
  if (method === "GET" && (body !== undefined || upload)) {
    throw new Error("GET does not accept a body or multipart upload.");
  }
  if (body !== undefined && upload) throw new Error("Use either JSON body or multipart upload.");
  const token = await getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let requestBody: BodyInit | undefined;
  if (upload) {
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields ?? {})) form.append(key, value);
    form.append(upload.field, new Blob([decodeBase64(upload.base64) as BlobPart], { type: upload.content_type }), upload.filename);
    requestBody = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    requestBody = JSON.stringify(body);
    if (new TextEncoder().encode(requestBody).byteLength > MAX_UPLOAD_BYTES) throw new Error("JSON body exceeds 8 MiB.");
  }
  const response = await fetch(`${FEISHU_BASE_URL}${safePath}`, {
    method, headers, body: requestBody, redirect: "manual", signal: AbortSignal.timeout(30000),
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Feishu response exceeds 8 MiB.");
  const bytes = await readLimited(response, MAX_RESPONSE_BYTES);
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error("Feishu response exceeds 8 MiB.");
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.includes("json")) {
    if (!response.ok) throw new Error(`Feishu HTTP ${response.status}: ${new TextDecoder().decode(bytes.slice(0, 300))}`);
    // Downloads are returned as base64 so MCP JSON transport remains valid.
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return { status: response.status, content_type: contentType, base64: btoa(binary) };
  }
  if (bytes.length === 0 && response.ok) return { status: response.status };
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as FeishuEnvelope<unknown>;
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(`Feishu API error ${payload.code ?? response.status}: ${payload.msg ?? response.statusText}`);
  }
  return payload;
}
