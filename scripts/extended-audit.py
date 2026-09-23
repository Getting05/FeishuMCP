import importlib.util,json,pathlib,base64,time
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
base=a.OUT; a.OUT=base.parent/'extended-audit';a.OUT.mkdir(exist_ok=True)
made=json.loads((base/'resources.json').read_text()); d=made['docx']['token']; folder=made['folder']['token']; b=made['bitable']['token']; extra={}
def save(kind,obj):
 if obj: extra[kind]=obj
 (a.OUT/'resources.json').write_text(json.dumps(extra,ensure_ascii=False,indent=2))
sheet=a.call('create.sheet_retry','create_feishu_file',file_type='sheet',title='MCP audit spreadsheet 20260923',folder_token=folder);save('sheet',sheet)
if sheet:
 s=sheet['token']; sheets=a.api('sheets.query','sheets','GET',f'/sheets/v3/spreadsheets/{s}/sheets/query')
 if sheets and sheets['data'].get('sheets'):
  sid=sheets['data']['sheets'][0]['sheet_id'];r=sid+'!A1:B2'
  a.api('sheets.write','sheets','PUT',f'/sheets/v2/spreadsheets/{s}/values',{'valueRange':{'range':r,'values':[['audit','value'],['ok',42]]}})
  a.api('sheets.readback','sheets','GET',f'/sheets/v2/spreadsheets/{s}/values/{r}')
# Bitable CRUD exclusively on a new test table.
t=a.api('bitable.table_create','bitable','POST',f'/bitable/v1/apps/{b}/tables',{'table':{'name':'MCP audit records','default_view_name':'Audit','fields':[{'field_name':'Name','type':1}]}});save('table',t)
if t:
 tid=t['data']['table_id']; p=f'/bitable/v1/apps/{b}/tables/{tid}'
 rec=a.api('bitable.record_create','bitable','POST',p+'/records',{'fields':{'Name':'original'}})
 if rec:
  rid=rec['data']['record']['record_id']; save('record',rec)
  a.api('bitable.record_update','bitable','PUT',p+'/records/'+rid,{'fields':{'Name':'updated'}})
  a.api('bitable.record_read','bitable','GET',p+'/records/'+rid)
  a.api('bitable.record_delete','bitable','DELETE',p+'/records/'+rid)
 a.api('bitable.table_delete','bitable','DELETE',p)
a.api('docs.content','docs','GET',f'/docs/v1/content?doc_token={d}&doc_type=docx&content_type=markdown')
a.api('drive.metadata','drive','POST','/drive/v1/metas/batch_query',{'request_docs':[{'doc_token':d,'doc_type':'docx'}],'with_url':True})
a.api('drive.members','drive','GET',f'/drive/v1/permissions/{d}/members?type=docx')
a.api('drive.views','drive','GET',f'/drive/v1/files/{d}/view_records?file_type=docx')
a.api('drive.likes','drive','GET',f'/drive/v2/files/{d}/likes?file_type=docx')
a.api('drive.permission_same_value','drive','PATCH',f'/drive/v1/permissions/{d}/public?type=docx',{'comment_entity':'anyone_can_view'})
# All comments are on our freshly created document, with no mentions or recipients.
c=a.api('comments.create','drive','POST',f'/drive/v1/files/{d}/comments?file_type=docx',{'reply_list':{'replies':[{'content':{'elements':[{'type':'text_run','text_run':{'text':'MCP audit comment'}}]}}]},'is_whole':True});save('comment',c)
if c:
 cid=c['data']['comment_id'];p=f'/drive/v1/files/{d}/comments/{cid}'
 replies=a.api('comments.replies','drive','GET',p+'/replies?file_type=docx')
 if replies and replies['data'].get('items'):
  rid=replies['data']['items'][0]['reply_id']
  a.api('comments.update','drive','PUT',p+f'/replies/{rid}?file_type=docx',{'content':{'elements':[{'type':'text_run','text_run':{'text':'MCP audit revised'}}]}})
  a.api('comments.get','drive','GET',p+'?file_type=docx')
  a.api('comments.delete','drive','DELETE',p+f'/replies/{rid}?file_type=docx')
raw=b'MCP file transfer audit\n'
u=a.api('drive.upload','drive','POST','/drive/v1/files/upload_all',upload={'field':'file','filename':'mcp-audit.txt','content_type':'text/plain','base64':base64.b64encode(raw).decode(),'fields':{'file_name':'mcp-audit.txt','parent_type':'explorer','parent_node':folder,'size':str(len(raw))}});save('upload',u)
if u:
 f=u['data']['file_token'];a.api('drive.download','drive','GET',f'/drive/v1/files/{f}/download');a.api('drive.delete_upload','drive','DELETE',f'/drive/v1/files/{f}?type=file')
copy=a.api('drive.copy','drive','POST',f'/drive/v1/files/{d}/copy',{'name':'MCP audit copied','type':'docx','folder_token':folder});save('copy',copy)
if copy:
 token=copy['data']['file']['token'];a.api('drive.delete_copy','drive','DELETE',f'/drive/v1/files/{token}?type=docx')
a.api('drive.move','drive','POST',f'/drive/v1/files/{d}/move',{'type':'docx','folder_token':folder})
a.api('drive.list','drive','GET',f'/drive/v1/files?folder_token={folder}')
export=a.api('export.create','drive','POST','/drive/v1/export_tasks',{'file_extension':'docx','token':d,'type':'docx'});save('export',export)
if export:
 ticket=export['data']['ticket']
 for _ in range(3):
  job=a.api('export.poll','drive','GET',f'/drive/v1/export_tasks/{ticket}?token={d}')
  if not job: break
  job=job['data'].get('result',{})
  if job.get('file_token'):
   a.api('export.download','drive','GET',f"/drive/v1/export_tasks/file/{job['file_token']}/download");break
  time.sleep(2)
# Board is created as an empty block within our test document.
board=a.api('board.create_container','docx','POST',f'/docx/v1/documents/{d}/blocks/{d}/children',{'children':[{'block_type':43,'board':{}}]});save('board',board)
if board:
 item=board['data']['children'][0]; bid=item.get('board',{}).get('token')
 if bid:
  a.api('board.list','board','GET',f'/board/v1/whiteboards/{bid}/nodes')
  a.api('board.delete_empty_probe','board','DELETE',f'/board/v1/whiteboards/{bid}/nodes/batch_delete',{'ids':[]})
