import importlib.util,json,base64,time
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
base=a.OUT;a.OUT=base.parent/'followup-audit';a.OUT.mkdir(exist_ok=True)
made=json.loads((base/'resources.json').read_text());ext=json.loads((base.parent/'extended-audit/resources.json').read_text());d=made['docx']['token'];f=made['folder']['token'];bid=ext['board']['data']['children'][0]['board']['token'];extra={}
def save(k,v):
 if v:extra[k]=v
 (a.OUT/'resources.json').write_text(json.dumps(extra,ensure_ascii=False,indent=2))
a.api('drive.views_fixed','drive','GET',f'/drive/v1/files/{d}/view_records?file_type=docx&page_size=10')
a.api('drive.members_retry','drive','GET',f'/drive/v1/permissions/{d}/members?type=docx')
u=a.api('drive.upload_retry','drive','POST','/drive/v1/files/upload_all',upload={'field':'file','filename':'mcp-audit.txt','content_type':'text/plain','base64':base64.b64encode(b'MCP transfer audit\n').decode(),'fields':{'file_name':'mcp-audit.txt','parent_type':'explorer','parent_node':f,'size':'19'}});save('upload',u)
if u:
 token=u['data']['file_token'];download=a.api('drive.download','drive','GET',f'/drive/v1/files/{token}/download')
 if download: print('DOWNLOAD_EQUALS_INPUT',base64.b64decode(download['base64'])==b'MCP transfer audit\n',flush=True)
 a.api('drive.delete_upload','drive','DELETE',f'/drive/v1/files/{token}?type=file')
ticket=ext['export']['data']['ticket'];job=a.api('export.poll_retry','drive','GET',f'/drive/v1/export_tasks/{ticket}?token={d}')
if job and job['data'].get('result',{}).get('file_token'):
 token=job['data']['result']['file_token'];a.api('export.download','drive','GET',f'/drive/v1/export_tasks/file/{token}/download')
v=a.api('version.create','drive','POST',f'/drive/v1/files/{d}/versions',{'name':'MCP audit v1','obj_type':'docx'});save('version',v)
a.api('version.list','drive','GET',f'/drive/v1/files/{d}/versions?obj_type=docx&page_size=10')
a.api('events.subscribe','drive','POST',f'/drive/v1/files/{d}/subscribe?file_type=docx')
a.api('events.status','drive','GET',f'/drive/v1/files/{d}/get_subscribe?file_type=docx')
a.api('events.unsubscribe','drive','DELETE',f'/drive/v1/files/{d}/delete_subscribe?file_type=docx')
# Create and read a small board diagram inside our document.
a.api('board.draw','board','POST',f'/board/v1/whiteboards/{bid}/nodes/plantuml',{'plant_uml_code':'graph LR\n A[Audit] --> B[Passed]','syntax_type':2})
a.api('board.readback','board','GET',f'/board/v1/whiteboards/{bid}/nodes')
a.api('board.image','board','GET',f'/board/v1/whiteboards/{bid}/download_as_image')
# Explicitly establish currently deployed routing limitations.
a.api('slides.actual_route','slides','POST','/slides_ai/v1/xml_presentations',{'xml_presentation':{'content':'<presentation xmlns="https://www.larkoffice.com/sml/2.0" width="960" height="540"><title>MCP audit</title></presentation>'}})
a.api('drive.search_route','drive','POST','/suite/docs-api/search/object',{'search_key':'MCP audit','count':1,'offset':0})
