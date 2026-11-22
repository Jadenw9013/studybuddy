import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { buildServer } from '../../apps/api/src/server.ts';
import { loadConfig } from '../../apps/api/src/config.ts';

const local=JSON.parse((await readFile('.data/supabase-local-status.json','utf8')).replace(/^\uFEFF/,''));
for(const name of ['API_URL','DB_URL','MAILPIT_URL'])if(!['127.0.0.1','localhost'].includes(new URL(local[name]).hostname))throw Error('This synthetic test runs only against local Supabase.');
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const config=loadConfig({APP_MODE:'live',NODE_ENV:'development',WEB_ORIGIN:'http://localhost:3000',API_PORT:'3012',DATABASE_URL:local.DB_URL,SUPABASE_URL:local.API_URL,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,WS_TICKET_SECRET:'local-synthetic-service-test-secret-32',INTERNAL_WORKER_SECRET:'local-synthetic-service-worker-secret-32',PAID_CALLS_ENABLED:'false'});
const {app,store}=await buildServer(config);await app.listen({host:'127.0.0.1',port:3012});
let worker:ReturnType<typeof spawn>|undefined;const created:string[]=[];
const report:any={kind:'real-local-supabase-synthetic-course',providerSessions:0,humanParticipants:0,checks:[]};
const origin='http://127.0.0.1:3012';let cookie='';
async function call(route:string,method='GET',body?:any,extra:Record<string,string>={}){const r=await fetch(origin+route,{method,headers:{Origin:config.origin,Cookie:cookie,...(body instanceof FormData?{}:body?{'Content-Type':'application/json'}:{}),...extra},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return r;}
async function wait<T>(read:()=>Promise<T|false>,label:string){for(let i=0;i<100;i++){const r=await read();if(r)return r;await new Promise(r=>setTimeout(r,200));}throw Error('Timed out: '+label);}
try{
 const email=`local-${crypto.randomUUID()}@example.test`;
 const user=await admin.auth.admin.createUser({email,email_confirm:true});if(user.error)throw Error('Could not create synthetic invited local account.');created.push(user.data.user.id);
 assert.equal((await call('/api/auth/code','POST',{email})).status,200);
 const mail:any=await wait(async()=>{const inbox=await(await fetch(local.MAILPIT_URL+'/api/v1/messages')).json();return inbox.messages?.find((m:any)=>m.To?.some((a:any)=>a.Address===email))??false;},'real local OTP delivery');
 const detail=await(await fetch(local.MAILPIT_URL+'/api/v1/message/'+mail.ID)).json();
 const otp=(detail.Text??detail.HTML??'').match(/\b\d{6}\b/)?.[0];if(!otp)throw Error('The local sign-in email did not contain the pasteable code.');
 const bad=await call('/api/auth/verify','POST',{email,code:'000000',adult:true,consent:true});assert.equal(bad.status,400);
 const signed=await call('/api/auth/verify','POST',{email,code:otp,adult:true,consent:true});assert.equal(signed.status,200);cookie=signed.headers.get('set-cookie')!.split(';')[0];report.checks.push({name:'invited local SMTP code, incorrect code denial, real Supabase session',passed:true});
 const course=await(await call('/api/courses','POST',{name:'Original local private course'})).json();
 const form=new FormData();for(const name of ['lecture.pdf','scores.csv','attempt.ipynb'])form.append('files',new Blob([await readFile(path.join('fixtures',name))]),name);
 assert.equal((await call(`/api/courses/${course.id}/uploads`,'POST',form)).status,200);
 worker=spawn(path.resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python'),['apps/worker/runner.py'],{windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,NODE_ENV:'development',INTERNAL_WORKER_SECRET:config.workerSecret,API_INTERNAL_ORIGIN:origin,ENABLE_HYBRID:'false'}});
 const ready:any=await wait(async()=>{const data=await(await call(`/api/courses/${course.id}`)).json();return data.sources?.length===3&&data.sources.every((s:any)=>s.status==='ready')?data:false;},'private storage and real worker/index publication');report.checks.push({name:'three ordinary multipart uploads through private Storage, worker and Postgres publication',passed:true,files:3});
 const l=await(await call('/api/lessons','POST',{courseId:course.id})).json();
 const found=await(await call(`/api/lessons/${l.id}/actions`,'POST',{actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:0,type:'course.search',targetId:l.id,expectedRevision:0,args:{query:'density divided count'}})).json();
 const citation=found.passages.find((p:any)=>p.filename==='lecture.pdf'&&p.locator.pageIndex===1);assert.ok(citation);
 const pdf=ready.sources.find((s:any)=>s.name==='lecture.pdf');const url=`/api/sources/${pdf.id}/versions/${pdf.versionId}/content`;
 assert.equal((await call(url,'GET',undefined,{Range:'bytes=0-40'})).status,206);report.checks.push({name:'exact physical page 2 evidence and authenticated PDF range',passed:true});
 const currentEpoch=async()=>{const response=await call(`/api/lessons/${l.id}`);assert.equal(response.status,200);return (await response.json()).lesson.epoch;};
 const action=async(body:any)=>{const response=await call(`/api/lessons/${l.id}/actions`,'POST',body);const value=await response.json();const code=typeof value.code==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(value.code)?value.code:'unclassified';assert.equal(response.status,200,`${body.type} returned HTTP ${response.status} (${code})`);return value;};
 const boardId=crypto.randomUUID(),scores=ready.sources.find((s:any)=>s.name==='scores.csv');assert.ok(scores);
 const createdBoard=await action({actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:await currentEpoch(),type:'board.create',targetId:boardId,expectedRevision:0,args:{kind:'histogram',sourceId:scores.id,column:'score',edges:[0,10,20,30,40],mode:'count'}});
 assert.deepEqual(createdBoard.board.result.bins.map((b:any)=>b.count),[2,3,2,3]);assert.equal(createdBoard.revision,1);
 const patch={actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:await currentEpoch(),type:'board.patch',targetId:boardId,expectedRevision:1,args:{binCount:5,mode:'density'}};
 const patched=await action(patch);assert.equal(patched.revision,2);assert.deepEqual(patched.board.result.edges,[0,8,16,24,32,40]);assert.deepEqual(patched.board.result.bins.map((b:any)=>b.count),[2,3,1,2,2]);
 assert.equal((await action(patch)).revision,2);
 const boardRows=await store.pool!.query('select revision,source_id,version_id,props from public.board_objects where owner_id=$1 and lesson_id=$2 and id=$3',[user.data.user.id,l.id,boardId]);
 assert.equal(boardRows.rows.length,1);assert.equal(Number(boardRows.rows[0].revision),2);assert.equal(boardRows.rows[0].source_id,scores.id);assert.equal(boardRows.rows[0].version_id,scores.versionId);assert.deepEqual(boardRows.rows[0].props.result.edges,[0,8,16,24,32,40]);
 const boardEvents=await store.pool!.query("select count(*)::int as n from public.action_events where owner_id=$1 and lesson_id=$2 and operation in ('board.create','board.patch')",[user.data.user.id,l.id]);assert.equal(boardEvents.rows[0].n,2);
 report.checks.push({name:'schema-validated histogram create and five-bin density patch persist normalized board/provenance; replay commits once',passed:true,boardRevisions:2,committedBoardActions:2});
 const practice=await action({actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:await currentEpoch(),type:'practice.present',targetId:l.id,expectedRevision:2,args:{skill:'histogram'}});
 assert.equal(practice.variantId,'density-4-20-5');
 const firstAnswer='Relative frequency is 0.4 and density is 0.2 per score unit. The bar height is probability.';
 const firstRequest={actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:await currentEpoch(),type:'practice.record',targetId:practice.id,expectedRevision:2,args:{answer:firstAnswer}};
 const first=await action(firstRequest);assert.equal(first.independent,true);assert.equal(first.result.numeric,false);
 const repeated=await action(firstRequest);assert.equal(repeated.id,first.id);
 assert.equal((await call(`/api/lessons/${l.id}/hint`,'POST',{})).status,200);
 const retryAnswer='Relative frequency is 0.20; density is 0.04 per score unit; bar area is probability.';
 const retry=await action({actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:await currentEpoch(),type:'practice.record',targetId:practice.id,expectedRevision:2,args:{answer:retryAnswer}});assert.equal(retry.independent,false);assert.equal(retry.result.numeric,true);
 const attempts=await store.pool!.query('select id,attempt_index,is_first,first_response,independent,hint_depth,outcome from public.attempts where owner_id=$1 and lesson_id=$2 and practice_id=$3 order by attempt_index',[user.data.user.id,l.id,practice.id]);
 assert.equal(attempts.rows.length,2);assert.equal(attempts.rows[0].id,first.id);assert.equal(attempts.rows[0].first_response,firstAnswer);assert.equal(attempts.rows[0].is_first,true);assert.equal(attempts.rows[0].independent,true);assert.equal(attempts.rows[0].hint_depth,0);assert.equal(attempts.rows[0].outcome.numeric,false);
 assert.equal(attempts.rows[1].id,retry.id);assert.equal(attempts.rows[1].first_response,retryAnswer);assert.equal(attempts.rows[1].is_first,false);assert.equal(attempts.rows[1].independent,false);assert.equal(attempts.rows[1].hint_depth,1);assert.equal(attempts.rows[1].outcome.numeric,true);
 report.checks.push({name:'schema-validated first independent answer and assisted retry persist separately; duplicate first submit preserves original attempt',passed:true,attempts:2,firstIndependent:1,assistedRetries:1});
 const token=decodeURIComponent(cookie.split('=')[1]);const browserClient=createClient(local.API_URL,local.ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
 const direct=await browserClient.storage.from('course-originals').download(`${user.data.user.id}/${course.id}/${pdf.id}/${pdf.versionId}`);assert.ok(direct.error);report.checks.push({name:'browser JWT cannot bypass version-aware API through private Storage',passed:true});
 assert.equal((await call(`/api/lessons/${l.id}/messages`,'POST',{clientMessageId:crypto.randomUUID(),text:'Why does the histogram peak at 3 rather than 0.03?'})).status,503);report.checks.push({name:'unconfigured text provider produces no fabricated live answer',passed:true});
 assert.equal((await call(`/api/sources/${pdf.id}`,'DELETE')).status,200);assert.equal((await call(url,'GET',undefined,{Range:'bytes=0-40'})).status,404);report.checks.push({name:'source deletion revokes future ranges using real private storage',passed:true});
 assert.equal((await call('/api/account','DELETE')).status,200);
 const erased=await store.pool!.query(`select
   (select count(*)::int from public.profiles where owner_id=$1) as profiles,
   (select count(*)::int from public.courses where owner_id=$1) as courses,
   (select count(*)::int from public.lessons where owner_id=$1) as lessons,
   (select count(*)::int from public.board_objects where owner_id=$1) as boards,
   (select count(*)::int from public.attempts where owner_id=$1) as attempts,
   (select count(*)::int from public.action_events where owner_id=$1) as actions,
   (select count(*)::int from public.retrieval_passages where owner_id=$1) as passages`,[user.data.user.id]);
 assert.ok(Object.values(erased.rows[0]).every(count=>count===0));report.checks.push({name:'account deletion removes normalized course, lesson, board, attempts, action receipts, and retrieval rows',passed:true});report.passed=true;
}catch(e:any){report.passed=false;report.failure=e.message;process.exitCode=1;}finally{worker?.kill();await app.close();for(const id of created)await admin.auth.admin.deleteUser(id);report.checksPassed=report.checks.filter((check:any)=>check.passed).length;report.checksRun=report.checks.length;report.checksPlanned=9;await mkdir('evals/results',{recursive:true});await writeFile('evals/results/supabase-service.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
