import importlib.util,json,os
spec=importlib.util.spec_from_file_location('audit','scripts/live-audit.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
base=a.OUT;a.OUT=base.parent/'finish-audit';a.OUT.mkdir(exist_ok=True)
made=json.loads((base/'resources.json').read_text());ext=json.loads((base.parent/'extended-audit/resources.json').read_text());d=made['docx']['token'];b=made['bitable']['token'];folder=made['folder']['token'];bid=ext['board']['data']['children'][0]['board']['token']
a.api('bitable.move_to_test_folder','drive','POST',f'/drive/v1/files/{b}/move',{'type':'bitable','folder_token':folder})
nodes=a.api('board.nodes_before_update','board','GET',f'/board/v1/whiteboards/{bid}/nodes')
if nodes and nodes['data'].get('nodes'):
 n=nodes['data']['nodes'][0];n['text']['text']='MCP audit updated node'
 a.api('board.node_update','board','POST',f'/board/v1/whiteboards/{bid}/nodes',{'nodes':[n]})
 updated=a.api('board.nodes_after_update','board','GET',f'/board/v1/whiteboards/{bid}/nodes')
 if updated:
  actual=next((x for x in updated['data'].get('nodes',[]) if x['id']==n['id']),None)
  verified=bool(actual and actual.get('text',{}).get('text')=='MCP audit updated node')
  (a.OUT/'board-update-verification.json').write_text(json.dumps({'verified_in_place_update':verified,'original_node_id':n['id'],'nodes':updated['data'].get('nodes',[])},ensure_ascii=False,indent=2))
  print('BOARD_IN_PLACE_UPDATE_VERIFIED',verified,flush=True)
 a.api('board.delete_actual_test_node','board','DELETE',f'/board/v1/whiteboards/{bid}/nodes/batch_delete',{'ids':[n['id']]})
# Recheck supplied node permissions once; no modification to existing content.
if os.environ.get('FEISHU_TEST_SPACE_ID') and os.environ.get('FEISHU_TEST_PARENT_NODE'):
 a.api('wiki.recheck_children','wiki','GET',f"/wiki/v2/spaces/{os.environ['FEISHU_TEST_SPACE_ID']}/nodes?parent_node_token={os.environ['FEISHU_TEST_PARENT_NODE']}")
a.api('drive.final_test_folder','drive','GET',f'/drive/v1/files?folder_token={folder}')
