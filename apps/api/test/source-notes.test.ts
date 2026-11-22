/** Real HTTP injection + durable fixture storage; no sockets or provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildServer} from '../src/server.ts';
import {loadConfig} from '../src/config.ts';
import {readyLessonSources,lessonContextBoard,lessonContextMessages,type Source} from '../src/store.ts';
import {voiceLessonContext} from '../src/voice-context.ts';
import {perform,search} from '../src/gateway.ts';
const origin='http://localhost:3000';
async function harness(){
 const directory=await mkdtemp(path.join(tmpdir(),'tutor-source-notes-')),config=loadConfig({APP_MODE:'fixture',NODE_ENV:'test',DATA_DIR:directory,PAID_CALLS_ENABLED:'false'});let server=await buildServer(config);
 const call=(cookie:string|undefined,method:any,url:string,payload?:any,requestOrigin=origin)=>server.app.inject({method,url,payload,headers:{origin:requestOrigin,...(cookie?{cookie:`tutor_session=${cookie}`}:{})}});
 const login=async(email='notes-owner@example.test')=>{const response=await call(undefined,'POST','/api/auth/verify',{email,code:'246810',adult:true,consent:true});assert.equal(response.statusCode,200);return response.cookies[0].value;};
 const setup=async(token:string)=>{const course=(await call(token,'POST','/api/courses',{name:'Synthetic notebook'})).json(),lesson=(await call(token,'POST','/api/lessons',{courseId:course.id})).json();let owner='';for(const candidate of await server.store.owners())if(await server.store.transact(candidate,s=>s.courses.some(c=>c.id===course.id)))owner=candidate;assert.ok(owner);return{course,lesson,owner};};
 const seed=async(owner:string,courseId:string)=>{
  const make=(name:string,text:string):Source=>({id:randomUUID(),courseId,name,versionId:randomUUID(),revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'private-synthetic',skippedPages:[],passages:[{id:randomUUID(),text,locator:{pageIndex:1,physicalPage:2}}]});
  const first=make('synthetic-lecture.pdf','Density equals bin count divided by sample size and width. Bar area is probability.'),second=make('synthetic-extra.txt','UNSELECTED_SOURCE_SECRET density equals another source rule.');second.notebook={cells:[{id:'private-cell',cellType:'markdown',source:'UNSELECTED_NOTEBOOK_SECRET'}]};
  await server.store.transact(owner,s=>s.sources.push(first,second));return{first,second,make};
 };
 return{call,login,setup,seed,get store(){return server.store;},reopen:async()=>{await server.app.close();server=await buildServer(config);},close:async()=>{await server.app.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'tutor-source-notes-'));await rm(directory,{recursive:true,force:true});}};
}

test('source scope defaults to all ready, persists explicit empty, restores dynamic all and uses compare-and-swap revisions',async()=>{
 const h=await harness();try{
  const token=await h.login(),{course,lesson,owner}=await h.setup(token),{first,second,make}=await h.seed(owner,course.id),url=`/api/lessons/${lesson.id}/sources`;
  const initial=(await h.call(token,'GET',url)).json();assert.equal(initial.selectedSourceIds,null);assert.deepEqual(initial.selectedSources,[first.id,second.id]);
  const empty=await h.call(token,'PATCH',url,{sourceIds:[],expectedRevision:0});assert.equal(empty.statusCode,200);assert.deepEqual(empty.json().selectedSources,[]);assert.equal(empty.json().revision,1);assert.equal(empty.json().epoch,1);
  assert.equal((await h.call(token,'PATCH',url,{sourceIds:[first.id],expectedRevision:0})).statusCode,409);
  assert.equal((await h.call(token,'PATCH',url,{sourceIds:[],expectedRevision:1})).json().epoch,1);
  const all=(await h.call(token,'PATCH',url,{sourceIds:null,expectedRevision:1})).json();assert.equal(all.revision,2);assert.equal(all.selectedSourceIds,null);
  const third=make('added.txt','New selected source');await h.store.transact(owner,s=>s.sources.push(third));assert.equal((await h.call(token,'GET',url)).json().selectedSources.length,3);
  await h.call(token,'PATCH',url,{sourceIds:[first.id],expectedRevision:2});const fourth=make('later.txt','Not automatically selected');await h.store.transact(owner,s=>s.sources.push(fourth));assert.deepEqual((await h.call(token,'GET',url)).json().selectedSources,[first.id]);
  await h.reopen();const signed=await h.login();assert.deepEqual((await h.call(signed,'GET',url)).json().selectedSourceIds,[first.id]);
 }finally{await h.close();}
});

test('source scope rejects wrong owner/course, unready sources, extra fields and stale races without changing confirmed selection',async()=>{
 const h=await harness();try{
  const token=await h.login(),other=await h.login('notes-other@example.test'),{course,lesson,owner}=await h.setup(token),different=await h.setup(token),{first,make}=await h.seed(owner,course.id),foreign=make('foreign.txt','foreign'),pending=make('pending.txt','pending');foreign.courseId=different.course.id;pending.status='indexing';await h.store.transact(owner,s=>s.sources.push(foreign,pending));const url=`/api/lessons/${lesson.id}/sources`;
  for(const [who,body,status] of [[undefined,{sourceIds:[],expectedRevision:0},401],[other,{sourceIds:[],expectedRevision:0},404],[token,{sourceIds:[foreign.id],expectedRevision:0},403],[token,{sourceIds:[pending.id],expectedRevision:0},409],[token,{sourceIds:[first.id,first.id],expectedRevision:0},400],[token,{sourceIds:[],expectedRevision:0,execute:true},400]] as const)assert.equal((await h.call(who,'PATCH',url,body)).statusCode,status);
  assert.equal((await h.call(token,'PATCH',url,{sourceIds:[],expectedRevision:0},'https://untrusted.example')).statusCode,403);
  const raced=await Promise.all([h.call(token,'PATCH',url,{sourceIds:[],expectedRevision:0}),h.call(token,'PATCH',url,{sourceIds:[first.id],expectedRevision:0})]);assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,409]);
 }finally{await h.close();}
});

test('retrieval, text, voice and model actions share selected sources while preserving original messages and board',async()=>{
 const h=await harness();try{
  const token=await h.login(),{course,lesson,owner}=await h.setup(token),{first,second}=await h.seed(owner,course.id);
  await h.store.transact(owner,s=>{const l=s.lessons[0];l.messages=[{id:'old-message',role:'tutor',text:'OLD_SCOPE_SECRET'}];l.board={id:randomUUID(),kind:'vectors',revision:1,sourceId:second.id,sourceVersionId:second.versionId,vectorA:[2,2],vectorB:[-1,3],result:{private:'OLD_BOARD_SECRET'},history:[]};});
  await h.call(token,'PATCH',`/api/lessons/${lesson.id}/sources`,{sourceIds:[first.id],expectedRevision:0});
  await h.store.transact(owner,s=>{const l=s.lessons[0];assert.equal(l.messages[0].text,'OLD_SCOPE_SECRET');assert.equal(l.board!.result.private,'OLD_BOARD_SECRET');assert.deepEqual(lessonContextMessages(l),[]);assert.equal(lessonContextBoard(s,l).result,undefined);assert.deepEqual(search(s,l,'density').map(p=>p.sourceId),[first.id]);const packed=JSON.stringify(voiceLessonContext(s,l));for(const secret of ['OLD_SCOPE_SECRET','OLD_BOARD_SECRET','UNSELECTED_SOURCE_SECRET','UNSELECTED_NOTEBOOK_SECRET'])assert.equal(packed.includes(secret),false);assert.throws(()=>perform(s,{actionId:randomUUID(),sessionId:l.id,turnEpoch:l.epoch,type:'board.patch',targetId:l.board!.id,expectedRevision:1,args:{vectorA:[3,3]}},'model'),/selected/);});
  const ask=await h.call(token,'POST',`/api/lessons/${lesson.id}/messages`,{clientMessageId:randomUUID(),text:'Explain density'});assert.equal(ask.statusCode,200);assert.deepEqual(ask.json().message.citations.map((c:any)=>c.sourceId),[first.id]);
  const scope=(await h.call(token,'GET',`/api/lessons/${lesson.id}/sources`)).json();await h.call(token,'PATCH',`/api/lessons/${lesson.id}/sources`,{sourceIds:[],expectedRevision:scope.revision});
  const empty=await h.call(token,'POST',`/api/lessons/${lesson.id}/messages`,{clientMessageId:randomUUID(),text:'Explain density'});assert.equal(empty.statusCode,200);assert.deepEqual(empty.json().message.citations,[]);
  await h.store.transact(owner,s=>{assert.deepEqual(readyLessonSources(s,s.lessons[0]),[]);assert.equal(voiceLessonContext(s,s.lessons[0]).materialsTotal,0);});
 }finally{await h.close();}
});

test('saving a completed tutor response resolves exact citations, replays once, edits with revision fences and survives reload',async()=>{
 const h=await harness();try{
  let token=await h.login();const {course,lesson,owner}=await h.setup(token),{first}=await h.seed(owner,course.id),messageId=randomUUID(),id=randomUUID(),url=`/api/lessons/${lesson.id}/notes`;
  await h.store.transact(owner,s=>s.lessons[0].messages.push({id:messageId,role:'tutor',text:'# My explanation\nUse the cited density rule.',citations:[{sourceId:first.id,versionId:first.versionId,passageId:first.passages[0].id,locator:{forged:'ignored'}}]}));
  const body={clientNoteId:id,fromMessageId:messageId};const saved=await h.call(token,'POST',url,body);assert.equal(saved.statusCode,200);const note=saved.json();assert.equal(note.title,'My explanation');assert.deepEqual(note.citations[0].locator,{pageIndex:1,physicalPage:2});assert.equal(note.creationFingerprint,undefined);
  assert.equal((await h.call(token,'POST',url,body)).json().id,id);assert.equal((await h.call(token,'GET',url)).json().notes.length,1);
  const edited=await h.call(token,'PATCH',url+'/'+id,{expectedRevision:1,content:'My independent summary.'});assert.equal(edited.statusCode,200);assert.equal(edited.json().revision,2);
  assert.equal((await h.call(token,'POST',url,body)).json().content,'My independent summary.');assert.equal((await h.call(token,'POST',url,{...body,title:'Different initial title'})).statusCode,409);assert.equal((await h.call(token,'PATCH',url+'/'+id,{expectedRevision:1,title:'Stale'})).statusCode,409);
  await h.reopen();token=await h.login();const list=(await h.call(token,'GET',url)).json().notes;assert.equal(list.length,1);assert.equal(list[0].content,'My independent summary.');assert.equal((await h.call(token,'GET',`/api/lessons/${lesson.id}`)).json().lesson.notes[0].creationFingerprint,undefined);
  const me=(await h.call(token,'GET','/api/me')).json();assert.equal(me.courses.find((c:any)=>c.id===course.id).sourceCount,2);assert.equal(me.courses.find((c:any)=>c.id===course.id).lessonCount,1);assert.ok(me.courses.find((c:any)=>c.id===course.id).createdAt);assert.equal(me.lessons.find((l:any)=>l.id===lesson.id).noteCount,1);
 }finally{await h.close();}
});

test('note permissions, citation scope and response identity stay independent of model text or source selection',async()=>{
 const h=await harness();try{
  const token=await h.login(),other=await h.login('notes-denied@example.test'),{course,lesson,owner}=await h.setup(token),different=await h.setup(token),{first,make}=await h.seed(owner,course.id),foreign=make('foreign.txt','other course');foreign.courseId=different.course.id;await h.store.transact(owner,s=>{s.sources.push(foreign);s.lessons[0].messages.push({id:'student',role:'student',text:'not a tutor response'},{id:'pending',role:'tutor',status:'pending',text:'not confirmed'});});
  const url=`/api/lessons/${lesson.id}/notes`,valid={title:'My note',content:'My words'},citation={sourceId:first.id,versionId:first.versionId,passageId:first.passages[0].id};
  for(const [who,body,status] of [[undefined,valid,401],[other,valid,404],[token,{...valid,citations:[{...citation,sourceId:foreign.id,versionId:foreign.versionId,passageId:foreign.passages[0].id}]},403],[token,{...valid,citations:[{...citation,passageId:'unknown'}]},404],[token,{fromMessageId:'student'},404],[token,{fromMessageId:'pending'},404],[token,{fromMessageId:'pending',content:'override'},400],[token,{...valid,citations:[{...citation,locator:{pageIndex:99}}]},400]] as const)assert.equal((await h.call(who,'POST',url,body)).statusCode,status);
  const id=randomUUID();assert.equal((await h.call(token,'POST',url,{...valid,clientNoteId:id})).statusCode,200);assert.equal((await h.call(other,'GET',url)).statusCode,404);assert.equal((await h.call(token,'POST',`/api/lessons/${different.lesson.id}/notes`,{...valid,clientNoteId:id})).statusCode,409);
  assert.equal((await h.call(token,'PATCH',`/api/lessons/${different.lesson.id}/notes/${id}`,{expectedRevision:1,title:'Wrong lesson'})).statusCode,404);
 }finally{await h.close();}
});

test('note deletion scrubs saved content, retains replay tombstone and lesson deletion removes its notes',async()=>{
 const h=await harness();try{
  const token=await h.login(),{lesson,owner}=await h.setup(token),url=`/api/lessons/${lesson.id}/notes`,body={clientNoteId:randomUUID(),title:'Private note',content:'SCRUB_ME'};await h.call(token,'POST',url,body);
  assert.equal((await h.call(token,'DELETE',url+'/'+body.clientNoteId,{expectedRevision:0})).statusCode,409);
  assert.equal((await h.call(token,'DELETE',url+'/'+body.clientNoteId,{expectedRevision:1})).json().deleted,true);assert.deepEqual((await h.call(token,'GET',url)).json().notes,[]);assert.equal((await h.call(token,'POST',url,body)).statusCode,409);
  await h.store.transact(owner,s=>{const note=s.lessons[0].notes![0];assert.equal(note.content,'');assert.deepEqual(note.citations,[]);assert.equal(note.deleted,true);});
  await h.call(token,'POST',url,{title:'Another note',content:'LESSON_DELETE_SCRUB'});assert.equal((await h.call(token,'DELETE',`/api/lessons/${lesson.id}`)).statusCode,200);await h.store.transact(owner,s=>assert.deepEqual(s.lessons[0].notes,[]));assert.equal((await h.call(token,'GET',url)).statusCode,404);
 }finally{await h.close();}
});
