import importlib.util,json,os
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py'); a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.OUT=a.OUT.parent/'wiki-audit';a.OUT.mkdir(exist_ok=True)
space=os.environ['FEISHU_TEST_SPACE_ID']; parent=os.environ['FEISHU_TEST_PARENT_NODE']
a.api('wiki.space','wiki','GET',f'/wiki/v2/spaces/{space}')
a.api('wiki.children','wiki','GET',f'/wiki/v2/spaces/{space}/nodes?parent_node_token={parent}')
made={}
obj=a.call('wiki.create_docx','create_feishu_wiki_document',space_id=space,parent_node_token=parent,title='MCP audit isolated test 20260923')
if obj: made['docx']=obj
(a.OUT/'resources.json').write_text(json.dumps(made,ensure_ascii=False,indent=2))
if obj:
    for kind in ['sheet','bitable','slides','mindnote']:
        o=a.call('wiki.create_'+kind,'create_feishu_file',file_type=kind,space_id=space,parent_node_token=obj['node']['node_token'],title='MCP audit '+kind)
        if o: made[kind]=o
        (a.OUT/'resources.json').write_text(json.dumps(made,ensure_ascii=False,indent=2))
