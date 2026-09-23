const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const {openApiRequest,checkedPath,readLimited,decodeBase64}=require('../.test-build/transport.js');
const {catalog,buildEndpointRequest,registerCatalog}=require('../.test-build/catalog.js');
const {verifyEvent,handleEvent,FeishuEventStore}=require('../.test-build/events.js');
const originalFetch=global.fetch; afterEach(()=>{global.fetch=originalFetch});
const token=async()=>'TEST_TOKEN';
test('catalog IDs and routes are unique',()=>{
 assert.equal(new Set(catalog.map(e=>e.id)).size,catalog.length);
 assert.equal(new Set(catalog.map(e=>e.method+e.path)).size,catalog.length);
});
for(const e of catalog) test(`${e.method} ${e.path}`,async()=>{
 const params=Object.fromEntries(Object.entries(e.parameters).filter(([k,v])=>v.required||v.location==='path').map(([k,v])=>[k,v.type==='integer'?1:'test123']));
 if(e.accessTokens?.length&&!e.accessTokens.includes('tenant')) {assert.throws(()=>buildEndpointRequest(e.id,params),/OAuth/);return;}
 const {path}=buildEndpointRequest(e.id,params);
 let calls=0;
 global.fetch=async(url,init)=>{calls++;assert.equal(url,'https://open.feishu.cn/open-apis'+path);assert.equal(init.method,e.method);assert.equal(init.headers.Authorization,'Bearer TEST_TOKEN');assert.equal(init.redirect,'manual');assert.ok(init.signal);if(e.method!=='GET')assert.deepEqual(JSON.parse(init.body),{test:true});return Response.json({code:0,data:{verified:true}});};
 assert.deepEqual(await openApiRequest(token,e.root,e.method,path,e.method==='GET'?undefined:{test:true}),{code:0,data:{verified:true}});assert.equal(calls,1);
});
test('DELETE transmits IDs as JSON, GET rejects body',async()=>{
 global.fetch=async(u,i)=>{assert.equal(i.method,'DELETE');assert.deepEqual(JSON.parse(i.body),{ids:['new_node']});return new Response(null,{status:204})};
 assert.deepEqual(await openApiRequest(token,'board','DELETE','/board/v1/whiteboards/test/nodes/batch_delete',{ids:['new_node']}),{status:204,content_type:'application/octet-stream',base64:''});
 await assert.rejects(()=>openApiRequest(token,'docs','GET','/docs/v1/content',{}),/GET/);
});
test('guard blocks traversal, auth, foreign domains and redirect paths',()=>{
 for(const path of ['/auth/v3/x','https://evil.test/drive/v1','//evil.test/drive/v1','/drive/../auth/x','/drive/%2e%2e/auth','/drive/v1\\x','/drive/v1/x#bad'])assert.throws(()=>checkedPath(path,'drive'));
 assert.equal(checkedPath('/slides_ai/v1/xml_presentations','slides'),'/slides_ai/v1/xml_presentations');
});
test('binary download and multipart upload roundtrip',async()=>{
 global.fetch=async(u,i)=>{assert.ok(i.body instanceof FormData);assert.equal(i.body.get('size'),'3');assert.deepEqual([...new Uint8Array(await i.body.get('file').arrayBuffer())],[0,128,255]);return new Response(Uint8Array.from([0,128,255]),{headers:{'content-type':'application/octet-stream'}})};
 assert.equal((await openApiRequest(token,'drive','POST','/drive/v1/files/upload_all',undefined,{field:'file',filename:'test.bin',content_type:'application/octet-stream',base64:'AID/',fields:{size:'3'}})).base64,'AID/');
});
test('errors and redirects are not successful downloads',async()=>{
 global.fetch=async()=>Response.json({code:131006,msg:'permission denied'});await assert.rejects(()=>openApiRequest(token,'wiki','GET','/wiki/v2/spaces'),/131006/);
 global.fetch=async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}});await assert.rejects(()=>openApiRequest(token,'drive','GET','/drive/v1/file'),/302/);
});
test('limits enforce UTF-8 bytes and stop streaming before buffering oversized response',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});
 await assert.rejects(()=>readLimited(new Response(stream),9),/exceeds/);assert.equal(cancelled,true);
 let calls=0;global.fetch=async()=>{calls++;return Response.json({code:0})};await assert.rejects(()=>openApiRequest(token,'docs','POST','/docs/v1/x',{text:'中'.repeat(3*1024*1024)}),/8 MiB/);assert.equal(calls,0);
 assert.throws(()=>decodeBase64('bad!'),/base64/);
});
test('catalog rejects missing path parameters and injection, exposes schema',async()=>{
 const e=catalog.find(e=>e.path.includes('{')&&e.accessTokens?.includes('tenant'));assert.throws(()=>buildEndpointRequest(e.id),/parameter/);
 const params=Object.fromEntries(Object.keys(e.parameters).map(k=>[k,'../evil']));assert.throws(()=>buildEndpointRequest(e.id,params),/parameter/);
 const tools={};registerCatalog({registerTool(n,s,fn){tools[n]=fn}},async()=>({code:0}));
 const r=await tools.search_feishu_api({endpoint_id:e.id,query:'',offset:0,limit:20});assert.equal(JSON.parse(r.content[0].text).endpoint.id,e.id);
});
const env={FEISHU_VERIFICATION_TOKEN:'verify-test',FEISHU_APP_ID:'app-test'};
const envelope={schema:'2.0',header:{event_id:'evt1',event_type:'drive.file.edit_v1',token:'verify-test',app_id:'app-test'},event:{file_token:'test'}};
function req(payload,headers={}){return new Request('https://test/feishu/events',{method:'POST',body:typeof payload==='string'?payload:JSON.stringify(payload),headers})}
test('event challenge and token/app validation',async()=>{
 assert.deepEqual(await verifyEvent(req({type:'url_verification',token:'verify-test',challenge:'abc'}),env),{challenge:'abc'});
 const e=await verifyEvent(req(envelope),env);assert.equal(e.event_id,'evt1');assert.equal(e.payload.header.token,undefined);
 await assert.rejects(()=>verifyEvent(req({...envelope,header:{...envelope.header,token:'bad'}}),env),/token/);
 await assert.rejects(()=>verifyEvent(req(envelope),{...env,FEISHU_APP_ID:'other'}),/app/);
 assert.equal((await handleEvent(req(envelope),env)).status,503);
});
async function encrypted(payload,age=0){
 const keyText='encrypt-test',enc=new TextEncoder();const hash=await webcrypto.subtle.digest('SHA-256',enc.encode(keyText));const key=await webcrypto.subtle.importKey('raw',hash,'AES-CBC',false,['encrypt']);const iv=webcrypto.getRandomValues(new Uint8Array(16));const cipher=await webcrypto.subtle.encrypt({name:'AES-CBC',iv},key,enc.encode(JSON.stringify(payload)));const raw=JSON.stringify({encrypt:Buffer.concat([Buffer.from(iv),Buffer.from(cipher)]).toString('base64')});const ts=String(Math.floor(Date.now()/1000)-age),nonce='nonce';const sig=Buffer.from(await webcrypto.subtle.digest('SHA-256',enc.encode(ts+nonce+keyText+raw))).toString('hex');return {raw,headers:{'x-lark-request-timestamp':ts,'x-lark-request-nonce':nonce,'x-lark-signature':sig}};
}
test('encrypted events verify signature, reject tampering and replay',async()=>{
 const e=await encrypted(envelope),cfg={...env,FEISHU_ENCRYPT_KEY:'encrypt-test'};
 assert.equal((await verifyEvent(req(e.raw,e.headers),cfg)).event_id,'evt1');
 await assert.rejects(()=>verifyEvent(req(e.raw,{...e.headers,'x-lark-signature':'bad'}),cfg),/signature/);
 const expired=await encrypted(envelope,400);await assert.rejects(()=>verifyEvent(req(expired.raw,expired.headers),cfg),/Expired/);
 const challenge=await encrypted({type:'url_verification',token:'verify-test',challenge:'secret'});assert.deepEqual(await verifyEvent(req(challenge.raw),cfg),{challenge:'secret'});
});
test('durable event storage deduplicates and paginates',async()=>{
 const data=new Map();const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),list:async({prefix,limit,startAfter})=>new Map([...data].sort().filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)).slice(0,limit)),transaction:async fn=>fn(storage)};
 const s=new FeishuEventStore({storage});
 for(const id of ['a','b','a'])assert.equal((await s.fetch(new Request('https://events/ingest',{method:'POST',body:JSON.stringify({event_id:id})}))).status,200);
 const page=await(await s.fetch(new Request('https://events/list?limit=1'))).json();assert.equal(data.size,2);assert.equal(page.events.length,1);assert.equal(page.next_cursor,'a');
 const next=await(await s.fetch(new Request('https://events/list?limit=1&cursor=a'))).json();assert.equal(next.events[0].event_id,'b');assert.equal(next.next_cursor,null);
});
test('search aliases are exact and query encoding remains valid',()=>{
 assert.equal(checkedPath('/suite/docs-api/search/object','drive'),'/suite/docs-api/search/object');
 assert.throws(()=>checkedPath('/suite/auth/token','drive'));
 assert.throws(()=>checkedPath('/search/v2/users/search','drive'));
 assert.equal(checkedPath('/drive/v1/files?page_token=a%2Fb%2Ec','drive'),'/drive/v1/files?page_token=a%2Fb%2Ec');
});
test('blank slides title is XML escaped',()=>{
 const {blankPresentation}=require('../.test-build/slides.js');const text=blankPresentation('A & <B> "C"').xml_presentation.content;
 assert.match(text,/<title>A &amp; &lt;B&gt; &quot;C&quot;<\/title>/);
});
test('event persistence failures are retryable',async()=>{
 const cfg={...env,FEISHU_EVENTS:{idFromName:()=>0,get:()=>({fetch:async()=>{throw new Error('storage unavailable')}})}};
 assert.equal((await handleEvent(req(envelope),cfg)).status,503);
});
