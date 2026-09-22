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
| `MCP_API_KEY` | Secret，可选 | 设置后 `/mcp` 要求 `Authorization: Bearer ...` |

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
