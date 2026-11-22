import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {Store,DomainError} from '../src/store.ts';
import {loadConfig} from '../src/config.ts';

const owner='a1000000-0000-4000-8000-000000000001',lessonId='a2000000-0000-4000-8000-000000000001';
function fakeStore(rows:any[],selectError?:Error){
 const store=new Store(loadConfig({APP_MODE:'fixture'})),calls:{sql:string;values?:any[]}[]=[];let releases=0;
 store.pool={connect:async()=>({query:async(sql:string,values?:any[])=>{calls.push({sql,values});if(sql.includes('from public.lessons')){if(selectError)throw selectError;return{rows};}return{rows:[]};},release:()=>{releases++;}})} as unknown as pg.Pool;
 return{store,calls,releases:()=>releases};
}
test('epoch packet guard uses an owner-scoped read-only normalized lookup without aggregate, lock, insert or projector',async()=>{
 const fixture=fakeStore([{turn_epoch:'7'}]);assert.equal(await fixture.store.readLessonEpoch(owner,lessonId),7);
 assert.equal(fixture.calls.length,5);assert.equal(fixture.calls[0].sql,'BEGIN READ ONLY');assert.equal(fixture.calls[1].sql,'SET LOCAL ROLE tutor_api');
 assert.deepEqual(fixture.calls[2].values,[owner]);const query=fixture.calls.find(call=>call.sql.includes('from public.lessons'))!;
 assert.deepEqual(query.values,[owner,lessonId]);assert.match(query.sql,/l\.owner_id=\$1 and l\.id=\$2/);assert.match(query.sql,/c\.owner_id=l\.owner_id and c\.id=l\.course_id/);assert.match(query.sql,/l\.deleted_at is null and c\.deleted_at is null/);
 assert.ok(fixture.calls.every(call=>!/(learner_state|for update|insert into|update public|delete from|projectState)/i.test(call.sql)));
 assert.equal(fixture.calls.at(-1)!.sql,'COMMIT');assert.equal(fixture.releases(),1);
});
test('absent or unauthorized normalized lesson fails closed, rolls back and releases its subject-scoped connection',async()=>{
 const fixture=fakeStore([]);await assert.rejects(fixture.store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);
 assert.equal(fixture.calls.at(-1)!.sql,'ROLLBACK');assert.equal(fixture.releases(),1);assert.ok(!fixture.calls.some(call=>call.sql==='COMMIT'));
});
test('epoch zero remains valid; corrupt or unsupported numeric epochs are never fabricated as zero',async()=>{
 assert.equal(await fakeStore([{turn_epoch:'0'}]).store.readLessonEpoch(owner,lessonId),0);
 for(const value of [null,undefined,'NaN','-1','9007199254740992']){
  const fixture=fakeStore([{turn_epoch:value}]);await assert.rejects(fixture.store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.code==='invalid_state');assert.equal(fixture.calls.at(-1)!.sql,'ROLLBACK');assert.equal(fixture.releases(),1);
 }
});
test('database/permission errors preserve failure and release the read connection',async()=>{
 const failure=Object.assign(Error('Synthetic permission failure'),{code:'42501'}),fixture=fakeStore([],failure);
 await assert.rejects(fixture.store.readLessonEpoch(owner,lessonId),error=>error===failure);assert.equal(fixture.calls.at(-1)!.sql,'ROLLBACK');assert.equal(fixture.releases(),1);
});
test('fixture epoch reads do not rewrite state, wait for an unrelated mutation lock or cache an old committed epoch',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'tutor-epoch-read-')),store=new Store(loadConfig({APP_MODE:'fixture',DATA_DIR:directory})),courseId=randomUUID();
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 try{
  await store.transact(owner,state=>{state.courses=[{id:courseId,name:'Synthetic course'}];state.lessons=[{id:lessonId,courseId,goal:'Synthetic epoch guard',epoch:4,quiet:false,messages:[],receipts:{},attempts:[]}];});
  const file=path.join(directory,'learners',owner+'.json'),before=await readFile(file),metadata=await stat(file);assert.equal(await store.readLessonEpoch(owner,lessonId),4);assert.deepEqual(await readFile(file),before);assert.equal((await stat(file)).mtimeMs,metadata.mtimeMs);
  const pending=store.transact(owner,async state=>{state.lessons[0].epoch=5;entered();await gate;});await started;
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{assert.equal(await Promise.race([store.readLessonEpoch(owner,lessonId),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Epoch read waited for mutation lock')),1000);})]),4);}finally{clearTimeout(timeout);release();}
  await pending;assert.equal(await store.readLessonEpoch(owner,lessonId),5);
 }finally{release();await store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'tutor-epoch-read-'));await rm(directory,{recursive:true,force:true});}
});
test('fixture owner/lesson/course/account deletion checks deny reads without creating missing account files',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'tutor-epoch-read-')),store=new Store(loadConfig({APP_MODE:'fixture',DATA_DIR:directory})),courseId=randomUUID();
 try{
  await assert.rejects(store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);await assert.rejects(stat(path.join(directory,'learners')),/ENOENT/);
  await store.transact(owner,state=>{state.courses=[{id:courseId,name:'Synthetic course'}];state.lessons=[{id:lessonId,courseId,goal:'Synthetic guard',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];});
  await assert.rejects(store.readLessonEpoch(randomUUID(),lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);await assert.rejects(store.readLessonEpoch(owner,randomUUID()),(error:unknown)=>error instanceof DomainError&&error.status===404);
  await store.transact(owner,state=>{state.courses[0].deleted=true;});await assert.rejects(store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);
  await store.transact(owner,state=>{state.courses[0].deleted=false;state.lessons[0].deleted=true;});await assert.rejects(store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);
  await store.transact(owner,state=>{state.lessons[0].deleted=false;state.deleted=true;});await assert.rejects(store.readLessonEpoch(owner,lessonId),(error:unknown)=>error instanceof DomainError&&error.status===401);
  await assert.rejects(store.readLessonEpoch('../outside',lessonId),(error:unknown)=>error instanceof DomainError&&error.status===404);
 }finally{await store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep+'tutor-epoch-read-'));await rm(directory,{recursive:true,force:true});}
});
