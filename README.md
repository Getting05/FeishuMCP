# Feishu MCP

部署在 Cloudflare Workers 上的飞书云文档 MCP Server，通过 Streamable HTTP `/mcp` 端点供 ChatGPT 等 MCP 客户端使用。

## 已实现工具

- `list_feishu_wiki_spaces`：列出应用可访问的知识库
- `create_feishu_wiki_document`：在指定知识库中新建 Docx 页面
- `resolve_feishu_url`：解析 Wiki/Docx URL，取得底层 `document_id`
- `read_feishu_document`：读取文档文本块及其 `block_id`
- `find_feishu_blocks`：按文本查找块
- `update_feishu_text_block`：按 `block_id` 替换文本
- `append_feishu_paragraph`：向文档或指定父块追加段落
- `feishu_bitable_api`、`feishu_board_api`、`feishu_docs_api`、`feishu_docx_api`、`feishu_drive_api`、`feishu_mindnote_api`、`feishu_sheets_api`、`feishu_slides_api`、`feishu_wiki_api`：按飞书开放平台文档调用对应领域的 OpenAPI

## 扩展 API 的用法

已在飞书开通的权限并不等于 MCP 工具；一项权限可能对应多个接口，也可能仅用于事件或文件访问。上述九个工具提供 REST 通道，覆盖所列 `bitable`、`board`、`docs`（含评论、订阅和权限）、`docx`、`drive`（含文件、导入导出）、`mindnote`、`sheets`、`slides`、`wiki` 权限对应的 **tenant token 可调用的 HTTP 接口**。其中 `space:*` 是云空间权限，通常通过 `feishu_drive_api` 的 `/drive/...` 路径调用；其余接口以飞书文档公布的实际 URL 为准。工具不凭权限名猜测 URL、参数或返回结构。

输入字段：

- `method`：`GET`、`POST`、`PATCH`、`PUT` 或 `DELETE`。
- `path`：从 `/open-apis` 后面开始的完整路径，含版本、资源 ID 和可选查询参数；必须以对应工具的领域前缀开头。
- `body`：写入接口的 JSON 请求体；按对应飞书接口文档填写。
- `upload`：multipart 上传（文件字段名、文件名、MIME 类型、base64 文件内容和附加表单字段），与 `body` 二选一。上限 8 MiB；较大文件应按飞书分片接口逐步上传，单片同样受此上限限制。

JSON 响应原样返回（包括 `code`、`data`、分页标记）；下载等二进制响应返回 `base64` 和 `content_type`，单次响应上限 8 MiB。调用异常会作为 MCP tool error 返回。分页、分片上传、异步导出任务需按飞书接口文档多次调用。

例如列出知识空间子节点（已知 `space_id`）：

```json
{"tool":"feishu_wiki_api","arguments":{"method":"GET","path":"/wiki/v2/spaces/<space_id>/nodes?page_size=50"}}
```

上述入口需要先设置 `MCP_API_KEY`。请把密钥配置到 Worker Secrets，并在 MCP 客户端配置 `Authorization: Bearer <MCP_API_KEY>`；不要把密钥提交到仓库。现有七个简化工具仍可使用原有连接方式。

### 适用边界

- 所有请求使用应用的 `tenant_access_token`。仅支持 `user_access_token` 的接口需要另外实现用户 OAuth 授权，不能通过这些工具以应用身份调用。
- 授权范围之外，应用还需要获得目标知识空间、文档或文件本身的访问权；请发布新版飞书应用并完成管理员审批。
- `docs:event.*` 与 `space:document.event:read` 的事件推送需要在飞书开放平台配置回调 URL、校验和事件处理流程；这些权限本身不是可同步读取的 REST 操作。此仓库目前尚未提供事件回调或持久化事件队列。
- 不提供自动枚举全部飞书接口的功能。调用者须查阅对应接口文档并传入准确路径及请求参数；部分能力可能使用不同的 API 前缀，不能由上述九个入口访问。

## Cloudflare 配置

仓库连接 Cloudflare Workers Builds 后，推送到 `main` 会触发部署。若构建设置要求填写命令：

- Build command：`npm run deploy`
- Deploy command：`npx wrangler deploy`

通常只需要 Deploy command；不要在 Build 和 Deploy 两阶段重复部署。

在 Worker 的 **Settings → Variables and Secrets** 添加：

| 名称 | 类型 | 说明 |
|---|---|---|
| `FEISHU_APP_ID` | Secret | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | Secret | 飞书自建应用 App Secret |
| `MCP_API_KEY` | Secret；扩展 API 必需 | 设置后 `/mcp` 要求 `Authorization: Bearer ...` |

不要把真实密钥写进 GitHub。

## 飞书应用权限

在飞书开放平台为自建应用申请并发布与以下操作对应的权限：

1. 查看和编辑知识库（用于列出知识库、创建页面及解析 `/wiki/` URL）
2. 查看云文档内容
3. 编辑云文档内容

应用还必须能访问目标文档：把应用/机器人加入相应知识空间或将目标文档授权给应用。权限变更后需发布新应用版本，并等待管理员审批生效。

## 连接地址

部署完成后：

```text
https://<你的-worker>.workers.dev/mcp
```

根地址会返回健康状态；`/mcp` 必须由 MCP 客户端访问，不能用普通浏览器页面判断工具是否正常。

## 本地开发（可选）

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

检查类型：

```bash
npm run typecheck
```

## 编辑流程建议

先调用 `read_feishu_document` 或 `find_feishu_blocks` 获取准确 `block_id`，再调用 `update_feishu_text_block`。更新工具会把目标块的内联文本替换为单一文本段，因此原有局部加粗、链接等内联样式不会保留。

## 安全提示

若不设置 `MCP_API_KEY`，任何知道 Worker URL 的人理论上都能调用写入工具。正式长期使用建议配置标准 OAuth；静态 Bearer Token 只适合客户端支持自定义 Authorization Header 的个人场景。
