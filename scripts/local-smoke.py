import importlib.util,json,urllib.request,datetime,pathlib
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.ENDPOINT='http://localhost:8787/mcp';a.OUT=a.OUT.parent/'local-smoke';a.OUT.mkdir(exist_ok=True)
init=a.rpc('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'test','version':'1'}});assert init['result']['serverInfo']['name']=='Feishu MCP'
inventory=a.rpc('tools/list',{})['result']['tools'];assert len(inventory)==20
(a.OUT/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2))
search=a.call('catalog.search','search_feishu_api',query='slides');assert search['total']>=11
schema=a.call('catalog.schema','search_feishu_api',endpoint_id='slides.xml_presentations.create');assert schema['endpoint']['path']=='/slides_ai/v1/xml_presentations'
blocked=a.rpc('tools/call',{'name':'call_feishu_api','arguments':{'endpoint_id':'wiki.spaces.create','body':{'name':'Must not create'}}});assert blocked['result']['isError']
id='local-smoke-'+datetime.datetime.now().strftime('%Y%m%d%H%M%S')
def event(payload):
 request=urllib.request.Request('http://localhost:8787/feishu/events',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(request) as r:return json.load(r)
assert event({'type':'url_verification','token':'local-test-only','challenge':'challenge-smoke'})=={'challenge':'challenge-smoke'}
payload={'schema':'2.0','header':{'event_id':id,'event_type':'drive.file.edit_v1','token':'local-test-only'},'event':{'file_token':'test-only'}}
assert event(payload)=={};assert event(payload)=={}
page=a.call('events.persisted','list_feishu_events',limit=100);assert len([e for e in page['events'] if e['event_id']==id])==1
assert 'local-test-only' not in json.dumps(page)
(a.OUT/'summary.json').write_text(json.dumps({'passed':True,'tools':20,'catalog_endpoints':205,'challenge':True,'durable_event_dedup':True,'event_id':id},indent=2))
print('LOCAL SMOKE PASS: 20 tools, catalog, user-only guard, challenge, real local Durable Object persistence/dedup')
