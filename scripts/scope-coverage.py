import json,pathlib
scopes='''bitable:app bitable:app:readonly
board:whiteboard:node:create board:whiteboard:node:delete board:whiteboard:node:read board:whiteboard:node:update
docs:doc docs:doc:readonly docs:document.comment:create docs:document.comment:delete docs:document.comment:read docs:document.comment:update docs:document.comment:write_only docs:document.content:read docs:document.media:download docs:document.media:upload docs:document.subscription docs:document.subscription:read docs:document:copy docs:document:export docs:document:import docs:event.document_deleted:read docs:event.document_edited:read docs:event.document_opened:read docs:event:subscribe docs:permission.member docs:permission.member:auth docs:permission.member:create docs:permission.member:delete docs:permission.member:readonly docs:permission.member:retrieve docs:permission.member:transfer docs:permission.member:update docs:permission.setting docs:permission.setting:read docs:permission.setting:readonly docs:permission.setting:write_only
docx:document docx:document.block:convert docx:document:create docx:document:readonly docx:document:write_only
drive:document.content:read drive:document.mention:read drive:drive drive:drive.metadata:readonly drive:drive.search:readonly drive:drive:readonly drive:drive:version drive:drive:version:readonly drive:export:readonly drive:file drive:file.like:readonly drive:file.meta.sec_label.read_only drive:file:download drive:file:readonly drive:file:upload drive:file:view_record:readonly
mindnote:node:create mindnote:node:read
sheets:spreadsheet sheets:spreadsheet.meta:read sheets:spreadsheet.meta:write_only sheets:spreadsheet:create sheets:spreadsheet:read sheets:spreadsheet:readonly sheets:spreadsheet:write_only
slides:presentation:create slides:presentation:read slides:presentation:screenshot slides:presentation:update slides:presentation:write_only
space:document.event:read space:document:delete space:document:move space:document:retrieve space:document:shortcut space:folder:create
wiki:member:create wiki:member:retrieve wiki:member:update wiki:node:copy wiki:node:create wiki:node:move wiki:node:read wiki:node:retrieve wiki:node:update wiki:setting:read wiki:setting:write_only wiki:space:read wiki:space:retrieve wiki:space:write_only wiki:wiki wiki:wiki:readonly'''.split()
catalog=json.loads(pathlib.Path('src/api-catalog.json').read_text());rows=[]
for scope in scopes:
 exact=[e['id'] for e in catalog if scope in (e.get('scopes') or [])]
 status='documented_routes' if exact else 'scope_mapping_unverified'
 note='目录声明不等于租户实际授权；权限之间可能是任选其一。'
 if scope.startswith('docs:event.document_') or scope=='space:document.event:read':
  status='callback_implemented_not_deployed';note='对应事件接收需要配置 /feishu/events、校验密钥和后台事件订阅；尚未端到端验证。'
 elif scope=='drive:drive.search:readonly':
  status='requires_user_oauth';note='旧搜索接口仅支持 user token；新版应用搜索需要额外 search:docs:read。用户清单 user=[]。'
 elif scope=='board:whiteboard:node:update':
  status='scope_mapping_unverified';note='当前官方 CLI/SDK 快照未提供独立节点更新接口；不能按权限名臆造 URL。通用通道仍可按后续官方文档调用。'
 elif scope.startswith('mindnote:'):
  note='已收录正确路由 /mindnote/v1/mindnotes/{mindnote_id}/nodes；缺少可访问的专用资源，未实测成功。'
 elif scope.startswith('slides:'):
  note='已修复 /slides_ai/v1 路由并增加云空间创建；未部署，线上尚未实测成功。'
 elif scope=='wiki:space:write_only':
  note='目录中的新建知识空间接口仅支持 user token；空间设置另有接口，不能以 tenant scopes 替代 OAuth。'
 rows.append(dict(scope=scope,status=status,documented_endpoints=exact,note=note))
pathlib.Path('scope-coverage.json').write_text(json.dumps({'tenant':scopes,'user':[],'scope_count':len(scopes),'coverage':rows},ensure_ascii=False,indent=2)+'\n')
print(len(scopes),'requested scopes;',sum(bool(r['documented_endpoints']) for r in rows),'with exact scope metadata')
