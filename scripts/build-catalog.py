"""Build pinned document API metadata from official larksuite/cli and node-sdk checkouts."""
import pathlib,json,re,subprocess,sys
cli=pathlib.Path(sys.argv[1]); sdk=pathlib.Path(sys.argv[2]); entries={}
def add(e):
    key=e['method']+' '+e['path']
    if key not in entries: entries[key]=e
for name in ['drive','sheets','wiki','slides','mindnotes']:
    doc=json.loads((cli/f'internal/registry/catalog/services/{name}.json').read_text())
    def walk(resources,prefix=''):
        for rn,resource in resources.items():
            for mn,m in resource.get('methods',{}).items():
                add(dict(id=f'{name}.{prefix}{rn}.{mn}',root='mindnote' if name=='mindnotes' else name,method=m['httpMethod'],path=doc['servicePath'].removeprefix('/open-apis')+'/'+m['path'],description=m.get('description',''),parameters=m.get('parameters',{}),requestBody=m.get('requestBody',{}),scopes=m.get('scopes',[]),accessTokens=m.get('accessTokens',[]),documentation=m.get('docUrl',''),source='larksuite/cli'))
            walk(resource.get('resources',{}),prefix+rn+'.')
    walk(doc['resources'])
for root in ['bitable','board','docs','docs_ai','docx','drive','mindnote','sheets','slides_ai','wiki']:
    s=(sdk/f'code-gen/projects/{root}.ts').read_text()
    for match in re.finditer(r'`\$\{this.domain\}/open-apis(/[^`]+)`[\s\S]{0,180}?method: "(GET|POST|PUT|PATCH|DELETE)"',s):
        path,method=match.groups(); path=re.sub(r':(\w+)',r'{\1}',path)
        before=s[:match.start()]; links=list(re.finditer(r'https://open.feishu.cn/api-explorer\?[^\s}]+',before)); link=links[-1].group() if links else ''
        from urllib.parse import parse_qs,urlparse
        q=parse_qs(urlparse(link).query)
        id='sdk.'+method.lower()+'.'+re.sub(r'[^A-Za-z0-9]+','.',path).strip('.')
        add(dict(id=id,root='slides' if root=='slides_ai' else 'docs' if root=='docs_ai' else root,method=method,path=path,description=id,parameters={n:{'type':'string','location':'path','required':True} for n in re.findall(r'{(\w+)}',path)},requestBody=None,scopes=None,accessTokens=None,documentation='https://github.com/larksuite/node-sdk/blob/'+subprocess.check_output(['git','-C',str(sdk),'rev-parse','HEAD'],text=True).strip()+'/code-gen/projects/'+root+'.ts#L'+str(s[:match.start()].count('\n')+1),source='larksuite/node-sdk'))
# Include legacy Sheets cell values endpoints, implemented in official CLI shortcuts.
for method,suffix,name in [('GET','values/{range}','read'),('PUT','values','write'),('POST','values_append','append'),('POST','values_batch_get','batch_read'),('POST','values_batch_update','batch_write')]:
    if name=='batch_read': continue # endpoint uses GET, query ranges; generic tool remains available.
    path='/sheets/v2/spreadsheets/{spreadsheet_token}/'+suffix
    add(dict(id='sheets.v2.values.'+name,root='sheets',method=method,path=path,description='Legacy Sheets cell values '+name,parameters={n:{'type':'string','location':'path','required':True} for n in re.findall(r'{(\w+)}',path)},requestBody=None,scopes=None,accessTokens=None,documentation='https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/'+('reading-a-single-range' if method=='GET' else 'write-data-to-a-single-range'),source='official Sheets API'))
add(dict(id='drive.search.legacy',root='drive',method='POST',path='/suite/docs-api/search/object',description='Legacy document search; user token only',parameters={},requestBody={'search_key':{'type':'string','required':True},'count':{'type':'integer'},'offset':{'type':'integer'}},scopes=['drive:drive.search:readonly'],accessTokens=['user'],documentation='https://open.feishu.cn/document/server-docs/docs/drive-v1/search/document-search',source='official Feishu API'))
add(dict(id='drive.search.v2',root='drive',method='POST',path='/search/v2/doc_wiki/search',description='Document and Wiki search; requires search:docs:read in addition to the supplied scope list',parameters={},requestBody=None,scopes=['search:docs:read'],accessTokens=['tenant','user'],documentation='https://github.com/larksuite/cli/blob/main/shortcuts/drive/drive_search.go',source='larksuite/cli'))
pathlib.Path('src/api-catalog.json').write_text(json.dumps(list(entries.values()),ensure_ascii=False,indent=2)+'\n')
pathlib.Path('THIRD_PARTY_NOTICES.md').write_text('# API metadata sources\n\nOfficial larksuite/cli service catalog and larksuite/node-sdk API paths, retrieved 2026-09-23.\n\n'+(cli/'LICENSE').read_text()+'\n\nNode SDK license:\n\n'+(sdk/'LICENSE').read_text())
print(len(entries),'catalog endpoints')
