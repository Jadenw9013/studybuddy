import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {perform} from '../src/gateway.ts';
import {emptyState} from '../src/store.ts';
import {parseAction,type Action} from '../../../packages/contracts/index.ts';
import {buildServer} from '../src/server.ts';
import {loadConfig} from '../src/config.ts';
import {projectState} from '../src/projector.ts';

function state(){const s=emptyState();s.courses=[{id:'c1',name:'Linear algebra'}];s.lessons=[{id:'l1',courseId:'c1',goal:'Understand projection',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];return s;}
const create:Action={actionId:'vector-create',sessionId:'l1',turnEpoch:0,type:'board.create',targetId:'vector-1',expectedRevision:0,args:{kind:'vectors',vectorA:[2,2],vectorB:[-1,3],showProjection:true,showAngle:true}};
test('typed vector create/patch/undo share one board identity and idempotent revision receipts without CSV',()=>{
 const s=state(),first=perform(s,parseAction(create));assert.equal(first.board.result.dot,4);assert.equal(first.revision,1);assert.equal(first.board.sourceId,undefined);
 const patch:Action={...create,actionId:'patch',type:'board.patch',expectedRevision:1,args:{vectorA:[1,0],vectorB:[0,2],showAngle:false}};
 const changed=perform(s,patch);assert.equal(changed.objectId,'vector-1');assert.equal(changed.revision,2);assert.equal(changed.board.result.dot,0);assert.equal(changed.board.result.angleDegrees,90);assert.equal(changed.board.showAngle,false);
 assert.equal(perform(s,patch).revision,2);assert.equal(s.lessons[0].board!.revision,2);
 assert.throws(()=>perform(s,{...patch,actionId:'stale'}),/chart changed/);
 const undone=perform(s,{...patch,actionId:'undo',type:'board.undo',expectedRevision:2,args:{}});assert.equal(undone.revision,3);assert.equal(undone.board.result.dot,4);assert.deepEqual(undone.board.vectorA,[2,2]);assert.equal(undone.board.showAngle,true);
});
test('vector schema and gateway reject arbitrary operations, missing pairs, cross-kind fields and wrong-course provenance',()=>{
 for(const args of [{kind:'vectors',vectorA:[1,2]}, {kind:'vectors',vectorA:[1,2,3],vectorB:[2,3]}, {kind:'vectors',vectorA:[1,2],vectorB:[2,3],javascript:'execute()'}, {kind:'vectors',vectorA:[1,2],vectorB:[2,Infinity]}])assert.throws(()=>parseAction({...create,args}),/invalid fields/);
 const s=state();s.courses.push({id:'other',name:'Other course'});s.sources.push({id:'foreign',courseId:'other',name:'attempt.ipynb',versionId:'v1',revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'private',passages:[],skippedPages:[]});
 assert.throws(()=>perform(s,{...create,args:{...create.args,sourceId:'foreign'}}),/this course/);
 perform(s,create);assert.throws(()=>perform(s,{...create,actionId:'bad-patch',type:'board.patch',expectedRevision:1,args:{binCount:5}}),/vector coordinates/);
 assert.equal(s.lessons[0].board!.revision,1);
});
test('zero vector results remain explicit through the trusted tool receipt',()=>{
 const s=state();const receipt=perform(s,{...create,args:{kind:'vectors',vectorA:[2,2],vectorB:[0,0]}});assert.equal(receipt.board.result.projection,null);assert.equal(receipt.board.result.angleDegrees,null);assert.match(receipt.board.result.projectionReason,/zero vector/);
});
test('normalized vector projection preserves source-less computed data and scoped board revision',async()=>{
 const owner=randomUUID(),course=randomUUID(),lesson=randomUUID(),board=randomUUID(),s=emptyState();
 s.courses=[{id:course,name:'Linear algebra'}];s.lessons=[{id:lesson,courseId:course,goal:'Understand projection',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];
 perform(s,{...create,sessionId:lesson,targetId:board});const calls:{sql:string;values:any[]}[]=[];
 await projectState({query:async(sql,values=[])=>{calls.push({sql,values});return{rows:[]};}},owner,s);
 const row=JSON.parse(calls.find(call=>call.sql.startsWith('insert into public.board_objects'))!.values[1])[0];assert.equal(row.kind,'vectors');assert.equal(row.source_id,null);assert.equal(row.version_id,null);assert.equal(row.props.result.dot,4);assert.equal(row.revision,1);
});
test('HTTP vector board persists after reload, patches in place, and denies malformed/stale actions',async()=>{
 const origin='http://localhost:3000',dir=await mkdtemp(path.join(tmpdir(),'tutor-vector-http-')),config=loadConfig({APP_MODE:'fixture',DATA_DIR:dir,WEB_ORIGIN:origin});
 let server=await buildServer(config),cookie='';
 const call=(method:any,url:string,payload?:any)=>server.app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
 const login=async()=>{const response=await call('POST','/api/auth/verify',{email:'vector-http@example.test',code:'246810',adult:true,consent:true});assert.equal(response.statusCode,200);cookie='tutor_session='+response.cookies[0].value;};
 try{
  await login();const course=(await call('POST','/api/courses',{name:'Linear algebra'})).json(),lesson=(await call('POST','/api/lessons',{courseId:course.id})).json();
  const original={...create,actionId:randomUUID(),sessionId:lesson.id,targetId:randomUUID()};const response=await call('POST',`/api/lessons/${lesson.id}/actions`,original);assert.equal(response.statusCode,200);assert.equal(response.json().board.result.dot,4);
  const snapshot=(await call('GET',`/api/lessons/${lesson.id}`)).json().lesson;
  const patch={...original,actionId:randomUUID(),type:'board.patch',turnEpoch:snapshot.epoch,expectedRevision:1,args:{vectorB:[0,0]}};const updated=await call('POST',`/api/lessons/${lesson.id}/actions`,patch);assert.equal(updated.statusCode,200);assert.equal(updated.json().board.result.angleDegrees,null);assert.equal(updated.json().revision,2);
  assert.equal((await call('POST',`/api/lessons/${lesson.id}/actions`,{...patch,actionId:randomUUID()})).statusCode,409);
  assert.equal((await call('POST',`/api/lessons/${lesson.id}/actions`,{...patch,actionId:randomUUID(),args:{vectorA:[1,2,3]}})).statusCode,400);
  await server.app.close();server=await buildServer(config);await login();const resumed=(await call('GET',`/api/lessons/${lesson.id}`)).json().lesson;assert.equal(resumed.board.id,original.targetId);assert.equal(resumed.board.revision,2);assert.equal(resumed.board.result.projection,null);assert.deepEqual(resumed.board.vectorA,[2,2]);
 }finally{await server.app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'tutor-vector-http-'));await rm(dir,{recursive:true,force:true});}
});
