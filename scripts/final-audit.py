import importlib.util,json,base64,time
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
base=a.OUT;a.OUT=base.parent/'final-audit';a.OUT.mkdir(exist_ok=True)
made=json.loads((base/'resources.json').read_text());ext=json.loads((base.parent/'extended-audit/resources.json').read_text());d=made['docx']['token'];bid=ext['board']['data']['children'][0]['board']['token'];extra={}
def save(k,v):
 if v:extra[k]=v
 (a.OUT/'resources.json').write_text(json.dumps(extra,ensure_ascii=False,indent=2))
node=a.api('board.node_create','board','POST',f'/board/v1/whiteboards/{bid}/nodes',{'nodes':[{'type':'text_shape','x':10,'y':10,'width':200,'height':80,'text':{'text':'MCP audit node'},'style':{'fill_color':'#ffffff','border_color':'#000000'},'shape':{'type':'rect'}}]});save('board_node',node)
a.api('board.readback','board','GET',f'/board/v1/whiteboards/{bid}/nodes')
ticket=ext['export']['data']['ticket']
job=a.api('export.poll_final','drive','GET',f'/drive/v1/export_tasks/{ticket}?token={d}')
if job and job['data'].get('result',{}).get('file_token'):
 token=job['data']['result']['file_token'];download=a.api('export.download','drive','GET',f'/drive/v1/export_tasks/file/{token}/download')
 if download:
  raw=base64.b64decode(download['base64']);(a.OUT/'exported-test.docx').write_bytes(raw)
  # Re-import the file exported from our own test document.
  upload=a.api('import.upload','drive','POST','/drive/v1/medias/upload_all',upload={'field':'file','filename':'mcp-audit.docx','content_type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','base64':download['base64'],'fields':{'file_name':'mcp-audit.docx','parent_type':'ccm_import_open','size':str(len(raw)),'extra':json.dumps({'obj_type':'docx','file_extension':'docx'})}});save('import_upload',upload)
  if upload:
   task=a.api('import.create','drive','POST','/drive/v1/import_tasks',{'file_extension':'docx','file_token':upload['data']['file_token'],'type':'docx','file_name':'MCP audit imported','point':{'mount_type':1,'mount_key':made['folder']['token']}});save('import_task',task)
   if task:
    t=task['data']['ticket']
    for _ in range(3):
     job=a.api('import.poll','drive','GET',f'/drive/v1/import_tasks/{t}');save('import_result',job)
     if job and job['data'].get('result',{}).get('job_status')==0:break
     time.sleep(2)
