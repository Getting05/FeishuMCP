import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  FEISHU_APP_ID: string;
  FEISHU_APP_SECRET: string;
  MCP_API_KEY?: string;
}

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}

interface ResolvedDocument {
  documentId: string;
  sourceType: "wiki" | "docx";
  sourceToken: string;
  title?: string;
}

interface FeishuBlock {
  block_id: string;
  block_type: number;
  parent_id?: string;
  children?: string[];
  [key: string]: unknown;
}

interface TextBlock {
  block_id: string;
  block_type: number;
  block_type_name: string;
  parent_id?: string;
  text: string;
}

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const BLOCK_TYPE_NAMES: Record<number, string> = {
  1: "page",
  2: "text",
  3: "heading1",
  4: "heading2",
  5: "heading3",
  6: "heading4",
  7: "heading5",
  8: "heading6",
  9: "heading7",
  10: "heading8",
  11: "heading9",
  12: "bullet",
  13: "ordered",
  14: "code",
  15: "quote",
  17: "todo",
  19: "callout",
};

let tokenCache:
  | { appId: string; token: string; expiresAtMs: number }
  | undefined;

function assertConfigured(env: Env): void {
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error(
      "Cloudflare Secrets FEISHU_APP_ID and FEISHU_APP_SECRET are required.",
    );
  }
}

async function getTenantAccessToken(env: Env): Promise<string> {
  assertConfigured(env);

  if (
    tokenCache?.appId === env.FEISHU_APP_ID &&
    Date.now() < tokenCache.expiresAtMs
  ) {
    return tokenCache.token;
  }

  const response = await fetch(
    `${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
      }),
    },
  );
  const payload = (await response.json()) as FeishuEnvelope<never>;

  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(
      `Unable to obtain Feishu tenant access token: ${payload.msg ?? response.statusText}`,
    );
  }

  const ttlSeconds = Math.max(60, (payload.expire ?? 7200) - 300);
  tokenCache = {
    appId: env.FEISHU_APP_ID,
    token: payload.tenant_access_token,
    expiresAtMs: Date.now() + ttlSeconds * 1000,
  };
  return payload.tenant_access_token;
}

async function feishuRequest<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getTenantAccessToken(env);
  const response = await fetch(`${FEISHU_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let payload: FeishuEnvelope<T>;

  try {
    payload = JSON.parse(raw) as FeishuEnvelope<T>;
  } catch {
    throw new Error(
      `Feishu returned a non-JSON response (${response.status}): ${raw.slice(0, 300)}`,
    );
  }

  if (!response.ok || payload.code !== 0) {
    throw new Error(
      `Feishu API error ${payload.code ?? response.status}: ${payload.msg ?? response.statusText}`,
    );
  }
  if (payload.data === undefined) {
    throw new Error("Feishu API response did not contain data.");
  }
  return payload.data;
}

function parseFeishuReference(input: string): {
  type: "wiki" | "docx";
  token: string;
} {
  const value = input.trim();
  if (!value) throw new Error("A Feishu document URL or token is required.");

  const wikiMatch = value.match(/\/wiki\/([^/?#]+)/i);
  if (wikiMatch) return { type: "wiki", token: wikiMatch[1] };

  const docxMatch = value.match(/\/docx\/([^/?#]+)/i);
  if (docxMatch) return { type: "docx", token: docxMatch[1] };

  if (/^[A-Za-z0-9_-]+$/.test(value)) {
    return { type: "docx", token: value };
  }

  throw new Error(
    "Unsupported Feishu reference. Use a /wiki/... URL, a /docx/... URL, or a document token.",
  );
}

async function resolveDocument(
  env: Env,
  urlOrToken: string,
): Promise<ResolvedDocument> {
  const parsed = parseFeishuReference(urlOrToken);
  if (parsed.type === "docx") {
    return {
      documentId: parsed.token,
      sourceType: "docx",
      sourceToken: parsed.token,
    };
  }

  const result = await feishuRequest<{
    node: { obj_token: string; obj_type: string; title?: string };
  }>(env, `/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`);

  if (!result.node?.obj_token) {
    throw new Error("The Feishu Wiki node did not resolve to a document token.");
  }
  if (result.node.obj_type !== "docx") {
    throw new Error(
      `The Wiki node points to ${result.node.obj_type}, but this MCP currently supports docx documents only.`,
    );
  }

  return {
    documentId: result.node.obj_token,
    sourceType: "wiki",
    sourceToken: parsed.token,
    title: result.node.title,
  };
}

async function listWikiSpaces(env: Env): Promise<
  Array<{
    space_id: string;
    name?: string;
    description?: string;
    visibility?: string;
  }>
> {
  const spaces: Array<{
    space_id: string;
    name?: string;
    description?: string;
    visibility?: string;
  }> = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({ page_size: "50" });
    if (pageToken) query.set("page_token", pageToken);
    const data = await feishuRequest<{
      items?: Array<{
        space_id: string;
        name?: string;
        description?: string;
        visibility?: string;
      }>;
      has_more?: boolean;
      page_token?: string;
    }>(env, `/wiki/v2/spaces?${query.toString()}`);
    spaces.push(...(data.items ?? []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);

  return spaces;
}

async function listAllBlocks(
  env: Env,
  documentId: string,
  maxBlocks = 1000,
): Promise<FeishuBlock[]> {
  const blocks: FeishuBlock[] = [];
  let pageToken: string | undefined;

  do {
    const query = new URLSearchParams({
      page_size: "500",
      document_revision_id: "-1",
    });
    if (pageToken) query.set("page_token", pageToken);

    const data = await feishuRequest<{
      items?: FeishuBlock[];
      has_more?: boolean;
      page_token?: string;
    }>(
      env,
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${query.toString()}`,
    );

    blocks.push(...(data.items ?? []));
    if (blocks.length >= maxBlocks) return blocks.slice(0, maxBlocks);
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);

  return blocks;
}

function getBlockText(block: FeishuBlock): string {
  const preferredKeys = [
    "page",
    "text",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "heading7",
    "heading8",
    "heading9",
    "bullet",
    "ordered",
    "code",
    "quote",
    "todo",
    "callout",
  ];

  for (const key of preferredKeys) {
    const richText = block[key] as
      | { elements?: Array<Record<string, unknown>> }
      | undefined;
    if (!richText?.elements) continue;

    return richText.elements
      .map((element) => {
        const textRun = element.text_run as { content?: string } | undefined;
        if (textRun?.content !== undefined) return textRun.content;
        const equation = element.equation as { content?: string } | undefined;
        if (equation?.content !== undefined) return equation.content;
        const mentionDoc = element.mention_doc as { title?: string } | undefined;
        if (mentionDoc?.title) return mentionDoc.title;
        return "";
      })
      .join("");
  }
  return "";
}

function simplifyBlocks(blocks: FeishuBlock[], includeEmpty = false): TextBlock[] {
  return blocks
    .map((block) => ({
      block_id: block.block_id,
      block_type: block.block_type,
      block_type_name:
        BLOCK_TYPE_NAMES[block.block_type] ?? `block_type_${block.block_type}`,
      parent_id: block.parent_id,
      text: getBlockText(block),
    }))
    .filter((block) => includeEmpty || block.text.length > 0);
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

function createServer(env: Env) {
  const server = new McpServer({ name: "Feishu MCP", version: "1.0.0" });

  server.registerTool(
    "list_feishu_wiki_spaces",
    {
      description:
        "List Feishu Wiki knowledge spaces accessible to the app. Use this to resolve a space name such as dobot to its space_id.",
      inputSchema: {},
    },
    async () => {
      try {
        const spaces = await listWikiSpaces(env);
        return textResult({ space_count: spaces.length, spaces });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_feishu_wiki_document",
    {
      description:
        "Create a new Docx page in a Feishu Wiki knowledge space. Returns both the Wiki node token and underlying document token.",
      inputSchema: {
        space_id: z
          .string()
          .min(1)
          .describe("Knowledge space ID returned by list_feishu_wiki_spaces"),
        title: z.string().min(1).max(200).describe("Title of the new Wiki page"),
        parent_node_token: z
          .string()
          .optional()
          .describe("Optional parent Wiki node token; omit to create at the space root"),
      },
    },
    async ({ space_id, title, parent_node_token }) => {
      try {
        const body: Record<string, unknown> = {
          obj_type: "docx",
          node_type: "origin",
          title,
        };
        if (parent_node_token) body.parent_node_token = parent_node_token;

        const data = await feishuRequest<{
          node?: {
            space_id?: string;
            node_token?: string;
            obj_token?: string;
            obj_type?: string;
            title?: string;
          };
        }>(
          env,
          `/wiki/v2/spaces/${encodeURIComponent(space_id)}/nodes`,
          { method: "POST", body: JSON.stringify(body) },
        );
        if (!data.node?.obj_token) {
          throw new Error("Feishu created the Wiki node but returned no document token.");
        }
        return textResult({ success: true, node: data.node });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "resolve_feishu_url",
    {
      description:
        "Resolve a Feishu Wiki or Docx URL to the underlying docx document ID.",
      inputSchema: {
        url_or_token: z
          .string()
          .describe("Feishu /wiki/ URL, /docx/ URL, or raw docx token"),
      },
    },
    async ({ url_or_token }) => {
      try {
        return textResult(await resolveDocument(env, url_or_token));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "read_feishu_document",
    {
      description:
        "Read a Feishu document and return its text blocks with block IDs for precise follow-up edits.",
      inputSchema: {
        url_or_token: z.string().describe("Feishu document URL or token"),
        include_empty: z.boolean().optional().default(false),
        max_blocks: z.number().int().min(1).max(2000).optional().default(1000),
      },
    },
    async ({ url_or_token, include_empty, max_blocks }) => {
      try {
        const resolved = await resolveDocument(env, url_or_token);
        const blocks = simplifyBlocks(
          await listAllBlocks(env, resolved.documentId, max_blocks),
          include_empty,
        );
        return textResult({
          document_id: resolved.documentId,
          title: resolved.title,
          block_count: blocks.length,
          blocks,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "find_feishu_blocks",
    {
      description:
        "Find text-containing blocks in a Feishu document. Returns matching block IDs for update_feishu_text_block.",
      inputSchema: {
        url_or_token: z.string().describe("Feishu document URL or token"),
        query: z.string().min(1).describe("Case-insensitive text to find"),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
    },
    async ({ url_or_token, query, limit }) => {
      try {
        const resolved = await resolveDocument(env, url_or_token);
        const needle = query.toLocaleLowerCase();
        const matches = simplifyBlocks(
          await listAllBlocks(env, resolved.documentId, 2000),
        )
          .filter((block) => block.text.toLocaleLowerCase().includes(needle))
          .slice(0, limit);
        return textResult({
          document_id: resolved.documentId,
          query,
          match_count: matches.length,
          matches,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_feishu_text_block",
    {
      description:
        "Replace all text in one Feishu text-like block. This replaces inline runs, so existing inline formatting in that block is not preserved.",
      inputSchema: {
        url_or_token: z.string().describe("Feishu document URL or token"),
        block_id: z.string().min(1).describe("Exact block ID returned by a read/find tool"),
        text: z.string().describe("Complete replacement text for the block"),
      },
    },
    async ({ url_or_token, block_id, text }) => {
      try {
        const resolved = await resolveDocument(env, url_or_token);
        const query = new URLSearchParams({ document_revision_id: "-1" });
        const data = await feishuRequest<{ block?: FeishuBlock }>(
          env,
          `/docx/v1/documents/${encodeURIComponent(resolved.documentId)}/blocks/${encodeURIComponent(block_id)}?${query.toString()}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              update_text_elements: {
                elements: [{ text_run: { content: text } }],
              },
            }),
          },
        );
        return textResult({
          success: true,
          document_id: resolved.documentId,
          block_id,
          text: data.block ? getBlockText(data.block) : text,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "append_feishu_paragraph",
    {
      description:
        "Append one or more plain-text paragraphs to a Feishu document or to a specified parent block.",
      inputSchema: {
        url_or_token: z.string().describe("Feishu document URL or token"),
        paragraphs: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe("Plain-text paragraphs to append in order"),
        parent_block_id: z
          .string()
          .optional()
          .describe("Optional parent block ID; defaults to the document root"),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Optional insertion index among the parent's children"),
      },
    },
    async ({ url_or_token, paragraphs, parent_block_id, index }) => {
      try {
        const resolved = await resolveDocument(env, url_or_token);
        const parentId = parent_block_id ?? resolved.documentId;
        const body: Record<string, unknown> = {
          children: paragraphs.map((content) => ({
            block_type: 2,
            text: { elements: [{ text_run: { content } }] },
          })),
        };
        if (index !== undefined) body.index = index;

        const query = new URLSearchParams({ document_revision_id: "-1" });
        const data = await feishuRequest<{
          children?: FeishuBlock[];
          document_revision_id?: number;
          client_token?: string;
        }>(
          env,
          `/docx/v1/documents/${encodeURIComponent(resolved.documentId)}/blocks/${encodeURIComponent(parentId)}/children?${query.toString()}`,
          { method: "POST", body: JSON.stringify(body) },
        );
        return textResult({
          success: true,
          document_id: resolved.documentId,
          parent_block_id: parentId,
          appended_blocks: (data.children ?? []).map((block) => ({
            block_id: block.block_id,
            text: getBlockText(block),
          })),
          document_revision_id: data.document_revision_id,
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.MCP_API_KEY) return true;
  return request.headers.get("Authorization") === `Bearer ${env.MCP_API_KEY}`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        service: "Feishu MCP",
        status: "ok",
        mcp_endpoint: "/mcp",
        feishu_configured: Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET),
        authentication: env.MCP_API_KEY ? "bearer" : "none",
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    if (!isAuthorized(request, env)) {
      return Response.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer" },
        },
      );
    }

    const handler = createMcpHandler(() => createServer(env), {
      route: "/mcp",
      responseMode: "auto",
    });
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
