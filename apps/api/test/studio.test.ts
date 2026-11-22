/** Real HTTP + durable fixture files, synthetic provider arithmetic; no paid calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {GoogleGenAI} from '@google/genai';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config.ts';
import {Store,fail,type Source} from '../src/store.ts';
import {registerStudio,resolveStudioContent} from '../src/studio.ts';
import {parseRateTable,type MeterPolicy} from '../src/meter.ts';

const origin='http://localhost:3000',model='synthetic-studio-model';
const units={input:{TEXT:16000,AUDIO:0,IMAGE:0},output:{TEXT:3000,AUDIO:0,IMAGE:0},cachedInput:{TEXT:16000,AUDIO:0,IMAGE:0}};
const policy:MeterPolicy={enabled:true,ceilingUsd:1,dailyTextLimit:50,limits:{text:units},rates:parseRateTable({version:'synthetic-test-only',currency:'USD',models:{[model]:{input:{TEXT:1},output:{TEXT:2},cachedInput:{TEXT:.1}}}})};
async function harness(provider?:any){
  const directory=await mkdtemp(path.join(tmpdir(),'tutor-studio-test-')),local=loadConfig({APP_MODE:'fixture',NODE_ENV:'test',WEB_ORIGIN:origin,DATA_DIR:directory});
  const config=provider?{...local,mode:'live',paid:true,geminiKey:'synthetic-test-only',textModel:model}:local;
  const owner=randomUUID(),other=randomUUID(),courseId=randomUUID(),lessonId=randomUUID(),otherLesson=randomUUID(),sourceId=randomUUID(),versionId=randomUUID(),passageId=randomUUID(),unselectedId=randomUUID();
  let store=new Store(local),app:ReturnType<typeof Fastify>;
  const source:Source={id:sourceId,versionId,courseId,name:'lecture.pdf',revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'synthetic-private',skippedPages:[],passages:[{id:passageId,text:'Breadth-first search uses a queue. It visits nodes in layers from the starting node.',locator:{pageIndex:2,physicalPage:3}}]};
  await store.transact(owner,s=>{s.courses.push({id:courseId,name:'Synthetic source course'});s.sources.push(source,{...source,id:unselectedId,versionId:randomUUID(),name:'unselected.txt',passages:[{id:randomUUID(),text:'UNSELECTED_PRIVATE_SOURCE',locator:{section:'private'}}]});
    for(const id of[lessonId,otherLesson])s.lessons.push({id,courseId,goal:'Understand BFS',epoch:0,messages:[],receipts:{},attempts:[],quiet:false,selectedSourceIds:[sourceId]});});
  const create=async()=>{app=Fastify({ajv:{customOptions:{removeAdditional:false}}});app.setErrorHandler((error:any,_request:any,reply:any)=>reply.code(error.status??error.statusCode??500).send({code:error.code,message:error.status?error.message:'Invalid request.'}));
    const environment=process.env as Record<string,string|undefined>,before=environment.NODE_ENV;environment.NODE_ENV='test';
    try{await registerStudio(app,{config,store,meterPolicy:policy,client:provider,auth:async req=>{const value=req.headers['x-owner'];if(typeof value!=='string')fail('unauthorized','Sign in.',401);return{owner:value};}});}finally{if(before===undefined)delete environment.NODE_ENV;else environment.NODE_ENV=before;}
  };await create();
  const url=`/api/lessons/${lessonId}/studio`,call=(method:any,url:string,body?:any,as:string|undefined=owner,requestOrigin=origin)=>app.inject({method,url,payload:body,headers:{origin:requestOrigin,...(as?{'x-owner':as}:{})}});
  const generate=(kind='guide',requestId=randomUUID(),extra={})=>call('POST',url,{kind,requestId,...extra});
  return{owner,other,courseId,lessonId,otherLesson,sourceId,versionId,passageId,unselectedId,source,url,call,generate,get store(){return store;},
    reopen:async()=>{await app.close();await store.close();store=new Store(local);await create();},
    close:async()=>{await app.close();await store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'tutor-studio-test-'));await rm(directory,{recursive:true,force:true});}};
}
const valid=(id:string)=>({title:'Queue study guide',sections:[{heading:'Queue',text:'Breadth-first search uses a queue.',citationIds:[id]}]});
function provider(response:(args:any)=>Promise<any>|any){let calls=0;return{get calls(){return calls;},models:{countTokens:async()=>({totalTokens:100}),generateContent:async(args:any)=>{calls++;return response(args);}}};}
const generated=(value:any)=>({text:JSON.stringify(value),candidates:[{finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15}});
async function waitUntil(fn:()=>boolean){for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.ok(fn());}

test('guide, cards and quiz use only selected exact citations and persist with independent card/quiz progress',async()=>{
  const h=await harness();try{
    const results=[];for(const kind of['guide','flashcards','quiz']){const r=await h.generate(kind);assert.equal(r.statusCode,200,r.body);const a=r.json().artifact;results.push(a);assert.equal(a.status,'ready');assert.equal(a.fixture,true);assert.equal(a.coverage.usedSourceCount,1);assert.equal(JSON.stringify(a).includes('UNSELECTED_PRIVATE_SOURCE'),false);
      const items=a.content.sections??a.content.cards??a.content.questions;for(const item of items){assert.equal(item.citations[0].sourceId,h.sourceId);assert.equal(item.citations[0].versionId,h.versionId);assert.equal(item.citations[0].passageId,h.passageId);assert.equal(item.citations[0].locator.physicalPage,3);}}
    const card=results[1],quiz=results[2];
    let r=await h.call('PATCH',`${h.url}/${card.id}/progress`,{expectedRevision:card.revision,knownCardIds:[card.content.cards[0].id]});assert.equal(r.statusCode,200);const next=r.json().artifact;
    assert.equal((await h.call('PATCH',`${h.url}/${card.id}/progress`,{expectedRevision:card.revision,cursor:0})).statusCode,409);
    assert.equal((await h.call('PATCH',`${h.url}/${card.id}/progress`,{expectedRevision:next.revision,knownCardIds:['foreign-card']})).statusCode,400);
    assert.equal((await h.call('PATCH',`${h.url}/${quiz.id}/progress`,{expectedRevision:quiz.revision,answers:{[quiz.content.questions[0].id]:2}})).statusCode,200);
    await h.reopen();const saved=(await h.call('GET',h.url)).json().artifacts;assert.equal(saved.length,3);assert.deepEqual(saved.find((a:any)=>a.id===card.id).progress.knownCardIds,[card.content.cards[0].id]);assert.equal(saved.find((a:any)=>a.id===quiz.id).progress.answers[quiz.content.questions[0].id],2);
    await h.store.transact(h.owner,s=>assert.equal(s.lessons[0].attempts.length,0));
  }finally{await h.close();}
});

test('auth, origin, source scope and strict schemas deny without fabricated artifacts',async()=>{
  const h=await harness();try{
    assert.equal((await h.call('POST',h.url,{kind:'guide',requestId:randomUUID()},'')).statusCode,401);
    assert.equal((await h.call('POST',h.url,{kind:'guide',requestId:randomUUID()},h.other)).statusCode,404);
    assert.equal((await h.call('POST',h.url,{kind:'guide',requestId:randomUUID()},h.owner,'https://untrusted.example')).statusCode,403);
    assert.equal((await h.generate('guide',randomUUID(),{runCode:true})).statusCode,400);
    await h.store.transact(h.owner,s=>{s.lessons[0].selectedSourceIds=[];});assert.equal((await h.generate()).statusCode,409);assert.equal((await h.call('GET',h.url)).json().artifacts.length,0);
  }finally{await h.close();}
});

test('request IDs bind owner-wide across lessons, remain tombstoned after removal/course purge, and never regenerate',async()=>{
  const h=await harness();try{
    const id=randomUUID(),first=await h.generate('guide',id);assert.equal(first.statusCode,200);assert.equal((await h.generate('guide',id)).json().artifact.revision,first.json().artifact.revision);
    assert.equal((await h.generate('quiz',id)).statusCode,409);assert.equal((await h.call('POST',`/api/lessons/${h.otherLesson}/studio`,{kind:'guide',requestId:id})).statusCode,409);
    assert.equal((await h.call('DELETE',`${h.url}/${id}`)).statusCode,200);assert.equal((await h.generate('guide',id)).statusCode,409);
    await h.store.transact(h.owner,s=>{s.lessons=s.lessons.filter(l=>l.id!==h.lessonId);});
    assert.equal((await h.call('POST',`/api/lessons/${h.otherLesson}/studio`,{kind:'guide',requestId:id})).statusCode,409);
  }finally{await h.close();}
});

test('historical artifacts survive selection changes, preserve exact old versions, and revoke after source deletion',async()=>{
  const h=await harness();try{
    const a=(await h.generate()).json().artifact;
    await h.store.transact(h.owner,s=>{s.lessons[0].selectedSourceIds=[];s.lessons[0].epoch++;s.sources[0]={...s.sources[0],versionId:randomUUID(),previous:[s.sources[0]]};});
    const old=(await h.call('GET',h.url)).json().artifacts[0];assert.equal(old.id,a.id);assert.equal(old.earlierSourceVersion,true);assert.equal(old.content.sections[0].citations[0].versionId,h.versionId);
    await h.store.transact(h.owner,s=>{s.sources[0].deleted=true;});assert.deepEqual((await h.call('GET',h.url)).json().artifacts,[]);
    await h.store.transact(h.owner,s=>{assert.equal(s.lessons[0].studio![0].content,undefined);assert.deepEqual(s.lessons[0].studio![0].sourceVersions,[]);});
  }finally{await h.close();}
});

test('structured provider output rejects extra fields, unknown citations and invalid quiz indexes',()=>{
  const excerpt={id:'p',sourceId:'s',versionId:'v',filename:'x',text:'Evidence',locator:{physicalPage:2}};
  for(const value of[{...valid('p'),extra:true},valid('not-selected'),{title:'x',sections:[]}])assert.throws(()=>resolveStudioContent('guide',value,[excerpt],'a'));
  assert.throws(()=>resolveStudioContent('quiz',{title:'x',questions:[{prompt:'q',options:['a','b','c','d'],correctIndex:4,explanation:'e',citationIds:['p']}]},[excerpt],'a'));
});

test('synthetic live call is reserved once, exact schema is sent and confirmed usage remains charged after scope changes',async()=>{
  let release!:(v:any)=>void;const gate=new Promise(resolve=>{release=resolve;}),p=provider(()=>gate),h=await harness(p as any);try{
    const id=randomUUID(),pending=h.generate('guide',id);await waitUntil(()=>p.calls===1);
    assert.equal((await h.generate('guide',id)).statusCode,202);assert.equal(p.calls,1);
    await h.store.transact(h.owner,s=>{s.lessons[0].sourceSelectionRevision=1;s.lessons[0].epoch++;});release(generated(valid(h.passageId)));
    const r=await pending;assert.equal(r.statusCode,409,r.body);const a=(await h.call('GET',h.url)).json().artifacts[0];assert.equal(a.status,'failed');assert.equal(a.content,undefined);
    await h.store.transact(h.owner,s=>{const record=s.reservations[`studio:${id}`] as any;assert.equal(record.settled,true);assert.ok(record.estimatedUsd>0);assert.equal(Object.keys(record.usageRecords).length,1);});
    assert.equal((await h.generate('guide',id)).json().artifact.status,'failed');assert.equal(p.calls,1);
  }finally{release?.(generated(valid(h.passageId)));await h.close();}
});

test('wrong-lesson delete cannot cancel active generation; correct delete prevents late publication and never resubmits',async()=>{
  let release!:(v:any)=>void,capturedSignal:AbortSignal|undefined;const gate=new Promise(resolve=>{release=resolve;}),p=provider(args=>{capturedSignal=args.config.abortSignal;return gate;}),h=await harness(p as any);try{
    const id=randomUUID(),pending=h.generate('guide',id);await waitUntil(()=>p.calls===1);
    assert.equal((await h.call('DELETE',`/api/lessons/${h.otherLesson}/studio/${id}`)).statusCode,404);assert.equal(capturedSignal?.aborted,false);
    assert.equal((await h.call('DELETE',`${h.url}/${id}`)).statusCode,200);assert.equal(capturedSignal?.aborted,true);release(generated(valid(h.passageId)));assert.equal((await pending).statusCode,409);assert.deepEqual((await h.call('GET',h.url)).json().artifacts,[]);assert.equal((await h.generate('guide',id)).statusCode,409);assert.equal(p.calls,1);
  }finally{release?.(generated(valid(h.passageId)));await h.close();}
});

test('malformed paid response settles real observed usage and becomes a safe failed artifact without secrets',async()=>{
  const p=provider(()=>generated({...valid('outside'),private:'NEVER_PUBLISH'})),h=await harness(p as any);try{
    const id=randomUUID(),r=await h.generate('guide',id);assert.equal(r.statusCode,502);assert.equal(r.body.includes('NEVER_PUBLISH'),false);const a=(await h.call('GET',h.url)).json().artifacts[0];assert.equal(a.status,'failed');assert.equal(a.fixture,true);assert.equal(a.content,undefined);
    await h.store.transact(h.owner,s=>assert.equal(s.reservations[`studio:${id}`].settled,true));assert.equal((await h.generate('guide',id)).statusCode,200);assert.equal(p.calls,1);
  }finally{await h.close();}
});

test('synthetic live success carries exact schema/citation, uses token limits, and does not present as provider evidence',async()=>{
  let supplied:any,p:any;const h=await harness(p=provider(args=>{supplied=args;const content=JSON.parse(args.contents);return generated(valid(content.excerpts[0].id));}) as any);try{
    const r=await h.generate();assert.equal(r.statusCode,200,r.body);assert.equal(r.json().artifact.fixture,true);assert.equal(supplied.config.maxOutputTokens,3000);assert.equal(supplied.config.responseJsonSchema.additionalProperties,false);assert.equal(p.calls,1);assert.equal(r.json().artifact.content.sections[0].citations[0].sourceId,h.sourceId);
  }finally{await h.close();}
});

test('background Studio can finish across new chat/board epochs while preserving its captured focus and goal',async()=>{
  let release!:(value:any)=>void,supplied:any;const gate=new Promise(resolve=>{release=resolve;}),p=provider(args=>{supplied=JSON.parse(args.contents);return gate;}),h=await harness(p as any);try{
    const pending=h.generate('guide',randomUUID(),{focus:'Queue behavior'});await waitUntil(()=>p.calls===1);
    await h.store.transact(h.owner,s=>{s.lessons[0].epoch+=3;s.lessons[0].goal='A newer conversation topic';s.lessons[0].messages.push({id:randomUUID(),role:'student',text:'Another question'});});
    release(generated(valid(h.passageId)));const r=await pending;assert.equal(r.statusCode,200,r.body);assert.equal(r.json().artifact.status,'ready');assert.equal(supplied.focus,'Queue behavior');assert.equal(supplied.lessonGoal,'Understand BFS');
  }finally{release?.(generated(valid(h.passageId)));await h.close();}
});

test('head source replacement fences publication even without a selection revision or conversation epoch change',async()=>{
  let release!:(value:any)=>void;const gate=new Promise(resolve=>{release=resolve;}),p=provider(()=>gate),h=await harness(p as any);try{
    const pending=h.generate();await waitUntil(()=>p.calls===1);await h.store.transact(h.owner,s=>{s.sources[0].versionId=randomUUID();});
    release(generated(valid(h.passageId)));assert.equal((await pending).statusCode,409);assert.equal((await h.call('GET',h.url)).json().artifacts.length,0);
  }finally{release?.(generated(valid(h.passageId)));await h.close();}
});

test('overlarge counted input never starts paid generation and releases its provision',async()=>{
  let calls=0;const p={models:{countTokens:async()=>({totalTokens:20000}),generateContent:async()=>{calls++;throw Error('Not reachable');}}},h=await harness(p as any);try{
    const id=randomUUID(),r=await h.generate('guide',id);assert.equal(r.statusCode,409);assert.equal(calls,0);
    await h.store.transact(h.owner,s=>{const reservation=s.reservations[`studio:${id}`] as any;assert.equal(reservation.settled,true);assert.equal(reservation.estimatedUsd,0);assert.notEqual(reservation.unknownCost,true);});
  }finally{await h.close();}
});

test('unexpected provider errors are redacted and conservatively settled rather than retried',async()=>{
  const p=provider(()=>{throw Error('secret-key-and-private-provider-body');}),h=await harness(p as any);try{
    const id=randomUUID(),r=await h.generate('guide',id);assert.equal(r.statusCode,502);assert.equal(r.body.includes('secret-key'),false);const a=(await h.call('GET',h.url)).json().artifacts[0];assert.equal(JSON.stringify(a).includes('secret-key'),false);assert.equal(a.error.code,'studio_generation_failed');
    await h.store.transact(h.owner,s=>{const reservation=s.reservations[`studio:${id}`] as any;assert.equal(reservation.settled,true);assert.equal(reservation.unknownCost,true);});assert.equal((await h.generate('guide',id)).statusCode,200);assert.equal(p.calls,1);
  }finally{await h.close();}
});

test('an abandoned pending request becomes failed after restart and never auto-resubmits',async()=>{
  const h=await harness();try{
    const id=randomUUID();await h.generate('guide',id);await h.store.transact(h.owner,s=>{const a=s.lessons[0].studio![0];a.status='generating';a.content=undefined;a.createdAt=new Date(Date.now()-120000).toISOString();});
    await h.reopen();const a=(await h.call('GET',h.url)).json().artifacts[0];assert.equal(a.status,'failed');assert.equal(a.error.code,'studio_interrupted');assert.equal(a.content,undefined);assert.equal((await h.generate('guide',id)).json().artifact.status,'failed');
  }finally{await h.close();}
});

test('bounded excerpt selection prioritizes the requested topic even when its source is after the first eight files',async()=>{
  const h=await harness();try{
    let focused='';await h.store.transact(h.owner,s=>{s.lessons[0].goal='';s.lessons[0].selectedSourceIds=undefined;
      for(let i=0;i<10;i++){const id=randomUUID();s.sources.push({...h.source,id,versionId:randomUUID(),name:`extra-${i}.txt`,passages:[{id:randomUUID(),text:i===9?'Topological ordering depends on predecessor constraints.':'Other selected source material.',locator:{section:'Concept'}}]});if(i===9)focused=id;}});
    const r=await h.generate('guide',randomUUID(),{focus:'Topological ordering'});assert.equal(r.statusCode,200,r.body);const a=r.json().artifact;assert.equal(a.coverage.selectedSourceCount,12);assert.equal(a.coverage.usedSourceCount,8);assert.equal(a.coverage.passageCount,8);assert.ok(a.content.sections.some((section:any)=>section.citations.some((citation:any)=>citation.sourceId===focused)));
  }finally{await h.close();}
});

test('installed Google SDK serializes only documented JSON schema keywords while local lengths/uniqueness remain strict',async()=>{
  const bodies:any[]=[];let passageId='';
  const sdk=new GoogleGenAI({apiKey:'synthetic-not-a-credential',httpOptions:{fetch:async(url,init)=>{
    const body=JSON.parse(String(init?.body));bodies.push(body);
    if(String(url).includes(':countTokens'))return new Response(JSON.stringify({totalTokens:100}),{headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(valid(passageId))}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15}}),{headers:{'content-type':'application/json'}});
  }}});
  const h=await harness(sdk);passageId=h.passageId;try{
    const r=await h.generate();assert.equal(r.statusCode,200,r.body);assert.equal(bodies.length,3);
    const schema=bodies[2].generationConfig.responseJsonSchema;assert.ok(schema);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.sections.maxItems,6);
    const encoded=JSON.stringify(schema);for(const key of['minLength','maxLength','uniqueItems'])assert.equal(encoded.includes(`"${key}"`),false);
    assert.deepEqual(bodies[0].generateContentRequest.generationConfig.responseJsonSchema,schema);
    const excerpt={id:passageId,sourceId:h.sourceId,versionId:h.versionId,filename:'lecture.pdf',text:'Queue',locator:{}};
    assert.throws(()=>resolveStudioContent('guide',{...valid(passageId),title:'x'.repeat(101)},[excerpt],'a'));
    assert.throws(()=>resolveStudioContent('quiz',{title:'x',questions:[{prompt:'q',options:['same','same','c','d'],correctIndex:0,explanation:'e',citationIds:[passageId]}]},[excerpt],'a'));
  }finally{await h.close();}
});

test('installed SDK sends only one paid generation request on transient 503; no automatic provider resubmit',async()=>{
  let generationCalls=0;
  const sdk=new GoogleGenAI({apiKey:'synthetic-not-a-credential',httpOptions:{fetch:async(url)=>{
    if(String(url).includes(':countTokens'))return new Response(JSON.stringify({totalTokens:100}),{headers:{'content-type':'application/json'}});
    generationCalls++;return new Response(JSON.stringify({error:{code:503,status:'UNAVAILABLE',message:'synthetic-redacted-provider-failure'}}),{status:503,headers:{'content-type':'application/json'}});
  }}}),h=await harness(sdk);try{
    const r=await h.generate();assert.equal(r.statusCode,503);assert.equal(generationCalls,1);assert.equal(r.body.includes('synthetic-redacted-provider-failure'),false);
  }finally{await h.close();}
});
