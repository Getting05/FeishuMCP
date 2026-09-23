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
- `create_feishu_file`：一键创建知识库页面（文档、电子表格、多维表格、幻灯片、思维导图），或云空间中的文档、电子表格、多维表格、文件夹
- `feishu_bitable_api`、`feishu_board_api`、`feishu_docs_api`、`feishu_docx_api`、`feishu_drive_api`、`feishu_mindnote_api`、`feishu_sheets_api`、`feishu_slides_api`、`feishu_wiki_api`：按飞书开放平台文档调用对应领域的 OpenAPI

## 扩展 API 的用法

### 新建文件

`create_feishu_file` 接收 `file_type` 和 `title`；在知识库中新建时传入 `space_id`，可选 `parent_node_token`。在云空间中新建时可选传入 `folder_token`（文件夹设为空字符串表示根目录）。两种位置不能混用。响应提供新建资源的 token，知识库还提供 `node_token`。

```json
{"tool":"create_feishu_file","arguments":{"file_type":"docx","title":"项目记录","space_id":"<space_id>"}}
```

```json
{"tool":"create_feishu_file","arguments":{"file_type":"sheet","title":"数据表","folder_token":"<folder_token>"}}
```

云空间支持 `docx`、`sheet`、`bitable`、`folder`，以及通过 `/slides_ai/v1/xml_presentations` 创建空白 `slides`（暂不接受 `folder_token`，创建后可用 Drive 移动）；知识库支持 `docx`、`sheet`、`bitable`、`slides`、`mindnote`。创建后的文档和电子表格为空；需要内容时继续调用编辑 API。使用应用的 `tenant_access_token` 时，云空间中指定的文件夹通常须由应用创建，知识库中则需要对应父节点容器编辑权限。

已在飞书开通的权限并不等于 MCP 工具；一项权限可能对应多个接口，也可能仅用于事件或文件访问。上述九个工具提供 REST 通道，可调用所列 `bitable`、`board`、`docs`（含评论、订阅和权限）、`docx`、`drive`（含文件、导入导出）、`mindnote`、`sheets`、`slides`、`wiki` 领域的 **tenant token 可调用的 HTTP 接口**；具体权限映射与未验证项见 `scope-coverage.json`。其中 `space:*` 是云空间权限，通常通过 `feishu_drive_api` 的 `/drive/...` 路径调用；其余接口以飞书文档公布的实际 URL 为准。工具不凭权限名猜测 URL、参数或返回结构。

输入字段：

- `method`：`GET`、`POST`、`PATCH`、`PUT` 或 `DELETE`。
- `path`：从 `/open-apis` 后面开始的完整路径，含版本、资源 ID 和可选查询参数；必须以对应工具的领域前缀开头。`feishu_slides_api` 另支持 `/slides_ai/`，`feishu_docs_api` 另支持 `/docs_ai/`；`feishu_drive_api` 另允许两个文档搜索的精确路径 `/suite/docs-api/search/object` 和 `/search/v2/doc_wiki/search`。
- `body`：POST、PATCH、PUT、DELETE 接口的 JSON 请求体；GET 不接受。画板批量删除和 Wiki 成员删除等接口需要 DELETE 请求体。
- `upload`：multipart 上传（文件字段名、文件名、MIME 类型、base64 文件内容和附加表单字段），与 `body` 二选一。上限 8 MiB；较大文件应按飞书分片接口逐步上传，单片同样受此上限限制。

JSON 响应原样返回（包括 `code`、`data`、分页标记）；下载等二进制响应返回 `base64` 和 `content_type`，单次响应上限 8 MiB。调用异常会作为 MCP tool error 返回。分页、分片上传、异步导出任务需按飞书接口文档多次调用。

例如列出知识空间子节点（已知 `space_id`）：

```json
{"tool":"feishu_wiki_api","arguments":{"method":"GET","path":"/wiki/v2/spaces/<space_id>/nodes?page_size=50"}}
```

上述入口与其他工具使用相同的连接方式，MCP 服务端不检查 `MCP_API_KEY`。Worker 仍须配置飞书应用凭据；不要把凭据提交到仓库。

### 适用边界

- 所有请求使用应用的 `tenant_access_token`。仅支持 `user_access_token` 的接口需要另外实现用户 OAuth 授权，不能通过这些工具以应用身份调用。
- 授权范围之外，应用还需要获得目标知识空间、文档或文件本身的访问权；请发布新版飞书应用并完成管理员审批。
- `docs:event.*` 与 `space:document.event:read` 的事件推送需要在飞书开放平台配置回调 URL、校验和事件处理流程；这些权限本身不是可同步读取的 REST 操作。本版已提供 `/feishu/events` 回调与 Durable Object 持久化事件收件箱，必须完成下方配置后才生效。
- `search_feishu_api` 提供官方 CLI/SDK 快照中 205 条文档接口记录，并非飞书全部 OpenAPI。`call_feishu_api` 根据接口 ID 填充路径与查询参数；未知或新增接口仍可使用领域通道。目录的 scopes/accessTokens 为 null 表示官方 SDK 快照缺少这类元数据，不代表无需权限。

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

`/mcp` 当前不做客户端身份校验。任何知道 Worker URL 的人都能以飞书应用身份调用工具，包括编辑、删除和权限管理接口。请限制 Worker 的访问范围，或在需要公开部署时为 MCP 接口加上客户端鉴权。

## 本次增加的工具

- `search_feishu_api`：按关键词、领域或 scope 查目录；指定 `endpoint_id` 返回完整参数说明。
- `call_feishu_api`：按目录 ID 调用一个接口；已知仅支持用户的接口会在本地拒绝。SDK 来源条目可附加文档规定的查询参数，CLI 来源条目检查已知必填参数。
- `list_feishu_events`：分页读取已经验签、持久化、按 event_id 去重的事件。游标按事件 ID 排序，不是时间顺序；收件箱读取不是可靠消费确认协议，并发新事件应周期性从头扫描、按 event_id 去重。

示例（先查元数据，确认当前参数和身份限制）：

```json
{"name":"search_feishu_api","arguments":{"query":"slides"}}
```

```json
{"name":"call_feishu_api","arguments":{"endpoint_id":"mindnotes.nodes.list","parameters":{"mindnote_id":"YOUR_TEST_MINDNOTE_TOKEN"}}}
```

## 事件回调部署

1. 使用现有飞书应用的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`。
2. 设置 Worker Secret `FEISHU_VERIFICATION_TOKEN`；若飞书开启加密，另设置 `FEISHU_ENCRYPT_KEY`，两端值一致。不要把密钥写入 Git。
3. `wrangler.jsonc` 已添加 `FEISHU_EVENTS` Durable Object 绑定和首次 SQLite migration。部署至现有 Worker 时保留已有迁移，避免覆盖其他环境的绑定。
4. 飞书开发者后台配置请求地址 `https://YOUR_WORKER/feishu/events`，验证 challenge 并添加所需文档事件；需要资源订阅的事件另调用 `/drive/v1/files/{file_token}/subscribe`。
5. 修改专用测试文档，用 `list_feishu_events` 验证到达。事件持久化失败不会返回成功 ACK，飞书可重试。

接收器支持明文 Verification Token 校验、AES-256-CBC 解密、SHA-256 签名、5 分钟签名时间窗、1 MiB 请求限制、按 event_id 去重。挑战校验按飞书协议使用验证 Token；加密普通事件必须同时通过签名。存储不保存 envelope 中的 verification token。事件目前永久保留，生产环境应根据数据保留要求管理/清理存储。配置缺失时回调返回 503，不会静默丢弃。

## 验证与边界

```bash
npm ci
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

`npm test` 包含每条目录路由的模拟转发契约测试，以及 DELETE body、二进制、multipart、大小限制、路径隔离、回调校验和去重测试。**模拟测试通过不代表该租户的全部飞书业务接口测试通过。**

`scripts/*audit.py` 是本次线上复现脚本，会创建测试资源。指定 `MCP_ENDPOINT` 和 `AUDIT_DIR` 可修改目标/结果目录；默认输出到项目外 `../../outputs`。扩展脚本读取先前生成的资源清单，不应用于不明来源的 token。每次响应都会立即落盘，不会自动重试不确定的写入。Wiki 脚本要求设置 `FEISHU_TEST_SPACE_ID` 和 `FEISHU_TEST_PARENT_NODE`，仅在指定节点下创建测试子节点。测试创建资源在报告中列出，未自动清理的保留供复查。

`scope-coverage.json` 逐项保留本次提供的 94 个 tenant scope。开通权限并不等于所有 API 都接受 tenant token：例如目录中的新建 Wiki 空间只支持 user token，旧版文档搜索亦需要用户身份。新版搜索支持应用身份，但需要额外的 `search:docs:read`。未提供用户授权时，不会伪装成已实现 user OAuth。

目录来自 `larksuite/cli` 和 `larksuite/node-sdk` 官方源码，许可证见 `THIRD_PARTY_NOTICES.md`。刷新方法：`python3 scripts/build-catalog.py /path/to/cli /path/to/node-sdk`，然后运行 `python3 scripts/scope-coverage.py` 和上述检查。SDK 中没有 scope 元数据的条目显式保留 null，不能用权限名猜测路由或补填未经验证的权限声明。
