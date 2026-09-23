"""Live MCP audit. Writes each result before starting the next request; no automatic write retries."""
import json, subprocess, pathlib, datetime, os
ENDPOINT=os.environ.get('MCP_ENDPOINT','https://feishumcp.chengetting.workers.dev/mcp')
OUT=pathlib.Path(os.environ.get('AUDIT_DIR','../../outputs/live-audit')); OUT.mkdir(parents=True,exist_ok=True)
results=[]
def rpc(method,params):
    body=json.dumps(dict(jsonrpc='2.0',id=len(results)+1,method=method,params=params))
    raw=subprocess.check_output(['curl','--http1.1','--max-time','50','-sS',ENDPOINT,'-H','Content-Type: application/json','-H','Accept: application/json, text/event-stream','--data-binary',body],text=True)
    for line in raw.splitlines():
        if line.startswith('data: '): return json.loads(line[6:])
    return json.loads(raw)
def call(label,name,**args):
    try:
        response=rpc('tools/call',dict(name=name,arguments=args)); result=response.get('result',response)
        text='\n'.join(c.get('text','') for c in result.get('content',[]))
        try: data=json.loads(text)
        except: data=text
        ok=not result.get('isError') and 'error' not in response
        entry=dict(label=label,tool=name,arguments=args,ok=ok,response=response)
    except Exception as e:
        data=None; ok=False; entry=dict(label=label,tool=name,arguments=args,ok=False,error=str(e))
    results.append(entry); (OUT/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(label, 'PASS' if ok else 'FAIL',str(data)[:220],flush=True)
    return data if ok else None
def api(label,root,method,path,body=None,**kw):
    if body is not None: kw['body']=body
    return call(label,'feishu_'+root+'_api',method=method,path=path,**kw)
if __name__=='__main__':
    (OUT/'inventory.json').write_text(json.dumps(rpc('tools/list',{}),ensure_ascii=False,indent=2))
    call('wiki.list','list_feishu_wiki_spaces')
    made={}
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    for kind in ['folder','docx','sheet','bitable']:
        obj=call('create.'+kind,'create_feishu_file',file_type=kind,title='MCP API audit '+stamp+' '+kind)
        if obj: made[kind]=obj
        (OUT/'resources.json').write_text(json.dumps(made,ensure_ascii=False,indent=2))
    if 'docx' in made:
        d=made['docx']['token']
        call('docx.resolve','resolve_feishu_url',url_or_token=d)
        added=call('docx.append','append_feishu_paragraph',url_or_token=d,paragraphs=['MCP audit original'])
        call('docx.read','read_feishu_document',url_or_token=d)
        call('docx.find','find_feishu_blocks',url_or_token=d,query='MCP audit original')
        if added and added.get('appended_blocks'):
            b=added['appended_blocks'][0]['block_id']
            call('docx.update','update_feishu_text_block',url_or_token=d,block_id=b,text='MCP audit updated')
            call('docx.readback','find_feishu_blocks',url_or_token=d,query='MCP audit updated')
        api('docx.metadata','docx','GET',f'/docx/v1/documents/{d}')
        api('drive.comments','drive','GET',f'/drive/v1/files/{d}/comments?file_type=docx')
        api('drive.permission','drive','GET',f'/drive/v1/permissions/{d}/public?type=docx')
    if 'sheet' in made:
        s=made['sheet']['token']
        api('sheets.metadata','sheets','GET',f'/sheets/v3/spreadsheets/{s}')
        sheets=api('sheets.list','sheets','GET',f'/sheets/v3/spreadsheets/{s}/sheets/query')
        if sheets and sheets['data'].get('sheets'):
            sid=sheets['data']['sheets'][0]['sheet_id']; r=sid+'!A1:B2'
            api('sheets.write','sheets','PUT',f'/sheets/v2/spreadsheets/{s}/values',{'valueRange':{'range':r,'values':[['audit','value'],['ok',42]]}})
            api('sheets.readback','sheets','GET',f'/sheets/v2/spreadsheets/{s}/values/{r}')
    if 'bitable' in made:
        b=made['bitable']['token']
        api('bitable.metadata','bitable','GET',f'/bitable/v1/apps/{b}')
        api('bitable.tables','bitable','GET',f'/bitable/v1/apps/{b}/tables')
    if 'folder' in made:
        f=made['folder']['token']
        api('drive.list','drive','GET',f'/drive/v1/files?folder_token={f}')
    # Every generic tool gets a local boundary test; this is NOT a successful upstream API test.
    for root in ['bitable','board','docs','docx','drive','mindnote','sheets','slides','wiki']:
        call(root+'.reject_wrong_domain','feishu_'+root+'_api',method='GET',path='/auth/v3/tenant_access_token/internal')
    # No fake Wiki IDs: leave Wiki creation blocked when there is no authorized test space.
