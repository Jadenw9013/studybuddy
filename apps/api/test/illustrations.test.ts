/** HTTP integration with a labelled synthetic provider; no sockets, DB or paid calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server.ts';
import {loadConfig} from '../src/config.ts';
import {BflError,type BflInput,generateIllustration} from '../src/bfl.ts';

const origin='http://localhost:3000';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfWQAAAAASUVORK5CYII=','base64');
const result=()=>({bytes:Buffer.from(image),mime:'image/png' as const,providerId:'synthetic-private-provider-id',width:1,height:1});
type Provider=typeof generateIllustration;
function deferredProvider(){
 const calls:BflInput[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const provider:Provider=async input=>{calls.push(input);await input.onSubmitted?.('synthetic-private-provider-id');await gate;return result();};
 return{calls,provider,release:()=>release()};
}
async function eventually<T>(read:()=>Promise<T|false>,label:string):Promise<T>{
 for(let i=0;i<200;i++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}
 throw Error(`Timed out waiting for ${label}`);
}
async function harness(provider:Provider,env:Record<string,string>={}){
 const dataDir=await mkdtemp(path.join(tmpdir(),'tutor-illustrations-test-'));
 const config=loadConfig({APP_MODE:'fixture',NODE_ENV:'test',WEB_ORIGIN:origin,DATA_DIR:dataDir,
  PAID_CALLS_ENABLED:'true',ENABLE_ILLUSTRATIONS:'true',BFL_API_KEY:'fixture-test-bfl-key',
  ILLUSTRATION_PRICE_VERSION:'synthetic-v1',ILLUSTRATION_REQUEST_COST_USD:'.015',...env});
 const create=async()=>{
  const testEnvironment=process.env as Record<string,string|undefined>,previous=testEnvironment.NODE_ENV;
  try{testEnvironment.NODE_ENV='test';return await buildServer(config,{illustrationProvider:provider});}
  finally{if(previous===undefined)delete testEnvironment.NODE_ENV;else testEnvironment.NODE_ENV=previous;}
 };
 let server=await create();
 const call=(token:string|undefined,method:any,url:string,payload?:any,requestOrigin=origin)=>server.app.inject({method,url,payload,headers:{origin:requestOrigin,...(token?{cookie:`tutor_session=${token}`}:{})}});
 const login=async(email='image-owner@example.test')=>{const response=await call(undefined,'POST','/api/auth/verify',{email,code:'246810',adult:true,consent:true});assert.equal(response.statusCode,200);return response.cookies[0].value;};
 const setup=async(token:string)=>{const c=await call(token,'POST','/api/courses',{name:'Synthetic illustration statistics'});assert.equal(c.statusCode,200);const course=c.json();const l=await call(token,'POST','/api/lessons',{courseId:course.id});assert.equal(l.statusCode,200);return{course,lesson:l.json()};};
 const snapshot=async(token:string,id:string)=>{const response=await call(token,'GET',`/api/lessons/${id}`);assert.equal(response.statusCode,200);const value=response.json();return value.lesson??value;};
 const make=async(token:string,id:string,overrides:Record<string,any>={})=>{const lesson=await snapshot(token,id);return{actionId:randomUUID(),sessionId:id,turnEpoch:lesson.epoch,type:'illustration.generate',targetId:randomUUID(),expectedRevision:lesson.board?.revision??0,args:{prompt:'A clear conceptual picture showing area as a filled region.',purpose:'Connect a bar area with a fraction of observations.',title:'Thinking about area'},...overrides};};
 const submit=(token:string,body:any)=>call(token,'POST',`/api/lessons/${body.sessionId}/actions`,body);
 const items=async(token:string,id:string)=>{const response=await call(token,'GET',`/api/lessons/${id}/illustrations`);assert.equal(response.statusCode,200);return response.json().items as any[];};
 const waitStatus=(token:string,id:string,imageId:string,status:string)=>eventually(async()=>{const j=(await items(token,id)).find(j=>j.id===imageId);return j?.status===status?j:false;},status);
 const ownerFor=async(courseId:string)=>{for(const owner of await server.store.owners())if(await server.store.transact(owner,s=>s.courses.some(c=>c.id===courseId)))return owner;throw Error('Synthetic fixture owner missing.');};
 return{config,dataDir,call,login,setup,snapshot,make,submit,items,waitStatus,ownerFor,
  get store(){return server.store;},
  reopen:async()=>{await server.app.close();server=await create();},
  close:async()=>{await server.app.close();const absolute=path.resolve(dataDir),prefix=path.resolve(tmpdir())+path.sep+'tutor-illustrations-test-';assert.ok(absolute.startsWith(prefix));await rm(absolute,{recursive:true,force:true});}};
}

test('illustration HTTP permission, Origin, lesson scope and strict action-schema denials never invoke provider',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;return result();});
 try{
  const one=await h.login(),two=await h.login('other-image-owner@example.test');const {lesson}=await h.setup(one),other=await h.setup(one);
  const body=await h.make(one,lesson.id);
  assert.equal((await h.call(undefined,'POST',`/api/lessons/${lesson.id}/actions`,body)).statusCode,401);
  assert.equal((await h.call(one,'POST',`/api/lessons/${lesson.id}/actions`,body,'https://untrusted.example')).statusCode,403);
  assert.equal((await h.call(two,'POST',`/api/lessons/${lesson.id}/actions`,body)).statusCode,404);
  assert.equal((await h.call(one,'POST',`/api/lessons/${other.lesson.id}/actions`,body)).statusCode,403);
  assert.equal((await h.submit(one,{...body,args:{...body.args,url:'https://untrusted.example/image.png'}})).statusCode,400);
  assert.equal((await h.submit(one,{...body,targetId:'not-an-image-uuid'})).statusCode,400);
  assert.equal((await h.call(two,'GET',`/api/lessons/${lesson.id}/illustrations`)).statusCode,404);
  assert.equal(calls,0);
 }finally{await h.close();}
});

test('duplicate generation races commit once, private bytes persist, and confirmed image survives server reload',async()=>{
 const deferred=deferredProvider(),h=await harness(deferred.provider);
 try{
  let token=await h.login();const {lesson}=await h.setup(token),body=await h.make(token,lesson.id);
  const responses=await Promise.all([h.submit(token,body),h.submit(token,body)]);assert.ok(responses.every(r=>r.statusCode===200));
  await eventually(async()=>deferred.calls.length===1,'one synthetic provider call');
  const changed=await h.submit(token,{...body,args:{...body.args,title:'Different request under same identity'}});assert.equal(changed.statusCode,409);assert.equal(changed.json().code,'payload_conflict');
  const busy=await h.submit(token,await h.make(token,lesson.id));assert.equal(busy.statusCode,409);assert.equal(busy.json().code,'busy');
  assert.equal((await h.items(token,lesson.id))[0].status,'generating');
  deferred.release();const ready=await h.waitStatus(token,lesson.id,body.targetId,'ready');assert.equal(ready.fixture,true);
  const content=await h.call(token,'GET',ready.imageUrl);assert.equal(content.statusCode,200);assert.equal(content.headers['content-type'],'image/png');assert.match(String(content.headers['cache-control']),/no-store/);assert.deepEqual(content.rawPayload,image);
  const other=await h.login('ready-image-other-owner@example.test');assert.equal((await h.call(other,'GET',ready.imageUrl)).statusCode,404);
  const listing=JSON.stringify(await h.items(token,lesson.id));assert.equal(listing.includes('storageKey'),false);assert.equal(listing.includes('synthetic-private-provider-id'),false);assert.equal(listing.includes('fixture-test-bfl-key'),false);
  const current=await h.snapshot(token,lesson.id);assert.equal(current.illustrations[0].id,body.targetId);assert.equal(current.illustrations[0].status,'ready');assert.equal('storageKey'in current.illustrations[0],false);assert.equal('fingerprint'in current.illustrations[0],false);
  const retry=await h.submit(token,body);assert.equal(retry.statusCode,200);assert.equal(retry.json().status,'ready');assert.equal(deferred.calls.length,1);
  await h.reopen();token=await h.login();assert.equal((await h.items(token,lesson.id))[0].status,'ready');assert.deepEqual((await h.call(token,'GET',ready.imageUrl)).rawPayload,image);assert.equal(deferred.calls.length,1);
 }finally{deferred.release();await h.close();}
});
test('interrupt invalidates an in-flight illustration even if provider returns late bytes',async()=>{
 const deferred=deferredProvider(),h=await harness(deferred.provider);
 try{
  const token=await h.login(),{lesson}=await h.setup(token),body=await h.make(token,lesson.id);assert.equal((await h.submit(token,body)).statusCode,200);
  await eventually(async()=>deferred.calls.length===1,'provider submission');
  assert.equal((await h.call(token,'POST',`/api/lessons/${lesson.id}/interrupt`,{quiet:true})).statusCode,200);assert.equal(deferred.calls[0].signal.aborted,true);
  deferred.release();await h.waitStatus(token,lesson.id,body.targetId,'stale');
  assert.equal((await h.call(token,'GET',`/api/lessons/${lesson.id}/illustrations/${body.targetId}/content`)).statusCode,404);
  assert.equal((await h.snapshot(token,lesson.id)).quiet,true);
 }finally{deferred.release();await h.close();}
});

test('manual board changes preserve deterministic chart and discard pending illustration at previous revision',async()=>{
 const deferred=deferredProvider(),h=await harness(deferred.provider);
 try{
  const token=await h.login(),{lesson}=await h.setup(token),boardId=randomUUID();
  const create={actionId:randomUUID(),sessionId:lesson.id,turnEpoch:0,type:'board.create',targetId:boardId,expectedRevision:0,args:{kind:'probability'}};
  assert.equal((await h.call(token,'POST',`/api/lessons/${lesson.id}/actions`,create)).statusCode,200);
  const body=await h.make(token,lesson.id);assert.equal((await h.submit(token,body)).statusCode,200);await eventually(async()=>deferred.calls.length===1,'provider submission');
  const current=await h.snapshot(token,lesson.id);
  const patch={actionId:randomUUID(),sessionId:lesson.id,turnEpoch:current.epoch,type:'board.patch',targetId:boardId,expectedRevision:current.board.revision,args:{conditioning:'column0'}};
  const changed=await h.call(token,'POST',`/api/lessons/${lesson.id}/actions`,patch);assert.equal(changed.statusCode,200);assert.equal(changed.json().revision,2);
  deferred.release();await h.waitStatus(token,lesson.id,body.targetId,'stale');
  const after=await h.snapshot(token,lesson.id);assert.equal(after.board.revision,2);assert.equal(after.board.result.conditioning,'column0');
  assert.equal((await h.call(token,'GET',`/api/lessons/${lesson.id}/illustrations/${body.targetId}/content`)).statusCode,404);
 }finally{deferred.release();await h.close();}
});

test('definite provider rejection exposes honest failure and releases estimate without fabricating image',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;throw new BflError('bfl_moderated',undefined,false,true);});
 try{
  const token=await h.login(),{lesson,course}=await h.setup(token),body=await h.make(token,lesson.id);assert.equal((await h.submit(token,body)).statusCode,200);
  const failed=await h.waitStatus(token,lesson.id,body.targetId,'failed');assert.equal(failed.costState,'released');assert.equal(failed.imageUrl,undefined);
  assert.match(failed.message,/provider|declined|could not/i);assert.equal((await h.call(token,'GET',`/api/lessons/${lesson.id}/illustrations/${body.targetId}/content`)).statusCode,404);
  const owner=await h.ownerFor(course.id),meter=await h.store.transact(owner,s=>s.metering!.passes.pilot);assert.equal(meter.heldUsd,0);assert.equal(meter.spentUsd,0);assert.equal(meter.unknownCost,false);
  assert.equal((await h.submit(token,body)).json().status,'failed');assert.equal(calls,1);
 }finally{await h.close();}
});

test('ambiguous provider failure retains provision and blocks further paid work without leaking provider error',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;throw Error('private-provider-error-secret https://private.invalid/token');});
 try{
  const token=await h.login(),{lesson,course}=await h.setup(token),body=await h.make(token,lesson.id);assert.equal((await h.submit(token,body)).statusCode,200);
  const failed=await h.waitStatus(token,lesson.id,body.targetId,'failed');assert.equal(failed.costState,'unknown');assert.equal(JSON.stringify(failed).includes('private-provider-error-secret'),false);
  const owner=await h.ownerFor(course.id),pass=await h.store.transact(owner,s=>s.metering!.passes.pilot);assert.equal(pass.unknownCost,true);assert.equal(pass.heldUsd,.015);assert.equal(pass.conservativeProvisionUsd,.015);
  const next=await h.submit(token,await h.make(token,lesson.id));assert.equal(next.statusCode,409);assert.equal(next.json().code,'budget_blocked');assert.equal(calls,1);
 }finally{await h.close();}
});

test('deleting pending illustration revokes content immediately and late provider bytes cannot restore it',async()=>{
 const deferred=deferredProvider(),h=await harness(deferred.provider);
 try{
  const token=await h.login(),other=await h.login('another-image-owner@example.test'),{lesson}=await h.setup(token),body=await h.make(token,lesson.id);
  assert.equal((await h.submit(token,body)).statusCode,200);await eventually(async()=>deferred.calls.length===1,'provider submission');
  const route=`/api/lessons/${lesson.id}/illustrations/${body.targetId}`;
  assert.equal((await h.call(other,'GET',route+'/content')).statusCode,404);
  const deleted=await h.call(token,'DELETE',route);assert.equal(deleted.statusCode,200);assert.equal(deleted.json().revoked,true);assert.equal((await h.call(token,'GET',route+'/content')).statusCode,404);
  deferred.release();await h.waitStatus(token,lesson.id,body.targetId,'cancelled');assert.equal((await h.call(token,'GET',route+'/content')).statusCode,404);assert.equal(deferred.calls.length,1);
 }finally{deferred.release();await h.close();}
});

test('daily count and shared pass ceiling reject requests before synthetic provider invocation',async()=>{
 let dailyCalls=0;const daily=await harness(async()=>{dailyCalls++;return result();},{ILLUSTRATION_DAILY_LIMIT:'1'});
 try{
  const token=await daily.login(),{lesson}=await daily.setup(token),body=await daily.make(token,lesson.id);assert.equal((await daily.submit(token,body)).statusCode,200);await daily.waitStatus(token,lesson.id,body.targetId,'ready');
  const limit=await daily.submit(token,await daily.make(token,lesson.id));assert.equal(limit.statusCode,429);assert.equal(limit.json().code,'quota_exhausted');assert.equal(dailyCalls,1);
 }finally{await daily.close();}
 let budgetCalls=0;const budget=await harness(async()=>{budgetCalls++;return result();});
 try{
  const token=await budget.login(),{lesson,course}=await budget.setup(token),owner=await budget.ownerFor(course.id);
  await budget.store.transact(owner,s=>{s.metering={activePassId:'pilot',textDays:{},passes:{pilot:{spentUsd:.01,heldUsd:0,ceilingUsd:.02,unknownCost:false,conservativeProvisionUsd:0}}};});
  const limit=await budget.submit(token,await budget.make(token,lesson.id));assert.equal(limit.statusCode,429);assert.equal(limit.json().code,'quota_exhausted');assert.equal(budgetCalls,0);
 }finally{await budget.close();}
});

test('wrong-lesson DELETE cannot abort a pending illustration in another authorized lesson',async()=>{
 const deferred=deferredProvider(),h=await harness(deferred.provider);
 try{
  const token=await h.login(),first=await h.setup(token),wrong=await h.setup(token),body=await h.make(token,first.lesson.id);
  assert.equal((await h.submit(token,body)).statusCode,200);await eventually(async()=>deferred.calls.length===1,'provider submission');
  const denied=await h.call(token,'DELETE',`/api/lessons/${wrong.lesson.id}/illustrations/${body.targetId}`);assert.equal(denied.statusCode,404);
  assert.equal(deferred.calls[0].signal.aborted,false);assert.equal((await h.items(token,first.lesson.id))[0].status,'generating');
  deferred.release();await h.waitStatus(token,first.lesson.id,body.targetId,'ready');assert.equal(deferred.calls.length,1);
 }finally{deferred.release();await h.close();}
});

test('owner-global illustration identity cannot be reused in another lesson or after course removal',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;return result();});
 try{
  const token=await h.login(),first=await h.setup(token),second=await h.setup(token),body=await h.make(token,first.lesson.id);
  assert.equal((await h.submit(token,body)).statusCode,200);await h.waitStatus(token,first.lesson.id,body.targetId,'ready');
  const owner=await h.ownerFor(second.course.id),before=await h.store.transact(owner,s=>({meter:s.metering,days:s.illustrationDays}));
  const reused=await h.make(token,second.lesson.id,{targetId:body.targetId});const denied=await h.submit(token,reused);assert.equal(denied.statusCode,409);assert.equal(denied.json().code,'payload_conflict');assert.equal(calls,1);
  assert.deepEqual(await h.store.transact(owner,s=>({meter:s.metering,days:s.illustrationDays})),before);
  assert.equal((await h.call(token,'DELETE',`/api/courses/${first.course.id}`)).statusCode,200);
  const stillDenied=await h.submit(token,await h.make(token,second.lesson.id,{targetId:body.targetId}));assert.equal(stillDenied.statusCode,409);assert.equal(stillDenied.json().code,'payload_conflict');assert.equal(calls,1);
 }finally{await h.close();}
});

test('single-image removal redacts private job and receipt prompt while original action remains idempotent',async()=>{
 let calls=0;const h=await harness(async()=>{calls++;return result();});
 try{
  const token=await h.login(),{lesson,course}=await h.setup(token),body=await h.make(token,lesson.id);
  assert.equal((await h.submit(token,body)).statusCode,200);await h.waitStatus(token,lesson.id,body.targetId,'ready');
  const snapshot=await h.snapshot(token,lesson.id);assert.equal(JSON.stringify(snapshot).includes(body.args.prompt),false);assert.equal('payload'in snapshot.receipts[body.actionId],false);
  const owner=await h.ownerFor(course.id),before=await h.store.transact(owner,s=>s.lessons.find(l=>l.id===lesson.id)!.illustrations![0].fingerprint);
  assert.equal((await h.call(token,'DELETE',`/api/lessons/${lesson.id}/illustrations/${body.targetId}`)).statusCode,200);
  const persisted=await h.store.transact(owner,s=>{const l=s.lessons.find(l=>l.id===lesson.id)!;return{job:l.illustrations![0],receipt:l.receipts[body.actionId]};});
  assert.equal(persisted.job.fingerprint,before);assert.equal(persisted.job.prompt,'[Removed]');assert.equal(persisted.job.purpose,'[Removed]');assert.equal(persisted.receipt.payload.includes(body.args.prompt),false);assert.equal(JSON.parse(persisted.receipt.payload).fingerprint,before);
  const replay=await h.submit(token,body);assert.equal(replay.statusCode,200);assert.equal(calls,1);
  const conflict=await h.submit(token,{...body,args:{...body.args,prompt:'A changed private illustration prompt for the same action.'}});assert.equal(conflict.statusCode,409);assert.equal(conflict.json().code,'payload_conflict');
  assert.equal((await h.call(token,'GET',`/api/lessons/${lesson.id}/illustrations/${body.targetId}/content`)).statusCode,404);
 }finally{await h.close();}
});
