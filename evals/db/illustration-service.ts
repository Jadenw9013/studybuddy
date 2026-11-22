/** Actual local Supabase/Auth/Postgres/Storage, explicitly synthetic image provider. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {buildServer} from '../../apps/api/src/server.ts';
import {loadConfig} from '../../apps/api/src/config.ts';
import type {generateIllustration} from '../../apps/api/src/bfl.ts';

const local=JSON.parse((await readFile('.data/supabase-local-status.json','utf8')).replace(/^\uFEFF/,''));
for(const name of ['API_URL','DB_URL','MAILPIT_URL'])if(!['localhost','127.0.0.1'].includes(new URL(local[name]).hostname))throw Error('Illustration probe runs only against local synthetic Supabase.');
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const config=loadConfig({APP_MODE:'live',NODE_ENV:'test',WEB_ORIGIN:'http://localhost:3000',DATABASE_URL:local.DB_URL,
 SUPABASE_URL:local.API_URL,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,
 WS_TICKET_SECRET:'local-illustration-probe-ticket-secret-32',INTERNAL_WORKER_SECRET:'local-illustration-probe-worker-secret-32',
 PAID_CALLS_ENABLED:'true',ENABLE_ILLUSTRATIONS:'true',BFL_API_KEY:'synthetic-provider-not-a-real-key',ILLUSTRATION_MODEL:'flux-2-klein-4b',
 ILLUSTRATION_REQUEST_COST_USD:'.015',ILLUSTRATION_PRICE_VERSION:'synthetic-probe-v1',ILLUSTRATION_DAILY_LIMIT:'10'});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfWQAAAAASUVORK5CYII=','base64');
let providerCalls=0,releaseFirst!:()=>void;
const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;});
const synthetic:typeof generateIllustration=async input=>{const index=++providerCalls;await input.onSubmitted?.(`synthetic-local-image-${index}`);if(index===1)await firstGate;return{bytes:Buffer.from(png),mime:'image/png',providerId:`synthetic-local-image-${index}`,width:1,height:1};};
let server:Awaited<ReturnType<typeof buildServer>>|undefined,owner='',cookie='',stage='startup';
const ownedKeys:string[]=[];
const report:any={kind:'real-local-supabase-with-synthetic-illustration-provider',providerSessions:0,paidProviderCalls:0,humanParticipants:0,
 fixtureImage:true,syntheticProviderInvocations:0,checks:[],checksPlanned:8,limits:['Image generation is a synthetic injected provider; this does not verify BFL access, quality, latency or billing.','HTTP requests use Fastify injection; Auth, SMTP, Postgres and private Storage are real local Supabase services.']};
async function call(method:any,url:string,payload?:any){return server!.app.inject({method,url,payload,headers:{origin:config.origin,...(cookie?{cookie}:{})}});}
async function ok(method:any,url:string,payload?:any){const response=await call(method,url,payload);const body=response.json();assert.equal(response.statusCode,200,`${method} ${url.split('/').slice(0,3).join('/')} returned ${response.statusCode} (${typeof body.code==='string'?body.code:'unclassified'})`);return body;}
async function wait<T>(read:()=>Promise<T|false>,label:string):Promise<T>{for(let i=0;i<150;i++){const result=await read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
const check=(name:string,details:Record<string,unknown>={})=>report.checks.push({name,passed:true,...details});
async function setup(){const course=await ok('POST','/api/courses',{name:'Original synthetic illustration course'}),lesson=await ok('POST','/api/lessons',{courseId:course.id});return{course,lesson};}
async function make(lessonId:string,courseId:string){const snapshot=await ok('GET',`/api/lessons/${lessonId}`),action={actionId:randomUUID(),sessionId:lessonId,turnEpoch:snapshot.lesson.epoch,type:'illustration.generate',targetId:randomUUID(),expectedRevision:snapshot.lesson.board?.revision??0,
 args:{prompt:'Private synthetic conceptual scene showing a filled region.',purpose:'Support an adult explanation of area without numerical labels.',title:'A conceptual area illustration'}};ownedKeys.push(`${owner}/${courseId}/illustrations/${lessonId}/${action.targetId}`);return action;}
async function ready(lessonId:string,imageId:string){return wait(async()=>{const data=await ok('GET',`/api/lessons/${lessonId}/illustrations`);return data.items.find((job:any)=>job.id===imageId&&job.status==='ready')??false;},'ready fixture image');}
try{
 const environment=process.env as Record<string,string|undefined>,previous=environment.NODE_ENV;
 try{environment.NODE_ENV='test';server=await buildServer(config,{illustrationProvider:synthetic});}
 finally{if(previous===undefined)delete environment.NODE_ENV;else environment.NODE_ENV=previous;}
 stage='invited sign-in';const email=`illustration-${randomUUID()}@example.test`,created=await admin.auth.admin.createUser({email,email_confirm:true});assert.ok(!created.error&&created.data.user);owner=created.data.user.id;
 await ok('POST','/api/auth/code',{email});
 const mail:any=await wait(async()=>{const inbox=await(await fetch(local.MAILPIT_URL+'/api/v1/messages')).json();return inbox.messages?.find((message:any)=>message.To?.some((address:any)=>address.Address===email))??false;},'local OTP');
 const details=await(await fetch(local.MAILPIT_URL+'/api/v1/message/'+mail.ID)).json(),otp=(details.Text??details.HTML??'').match(/\b\d{6}\b/)?.[0];assert.ok(otp);
 const signed=await call('POST','/api/auth/verify',{email,code:otp,adult:true,consent:true});assert.equal(signed.statusCode,200);cookie=`tutor_session=${signed.cookies[0].value}`;check('real invited email-code sign-in through local SMTP and Supabase Auth');
 const one=await setup(),action=await make(one.lesson.id,one.course.id),route=`/api/lessons/${one.lesson.id}/actions`;
 stage='queued and generating persistence';const requests=await Promise.all([call('POST',route,action),call('POST',route,action)]);assert.ok(requests.every(r=>r.statusCode===200));assert.equal(requests[0].json().status,'queued');
 await wait(async()=>providerCalls===1,'one provider invocation');
 const generating=await server.store.pool!.query('select status,submitted,fixture from public.illustrations where owner_id=$1 and id=$2',[owner,action.targetId]);assert.equal(generating.rows[0].status,'generating');assert.equal(generating.rows[0].submitted,true);assert.equal(generating.rows[0].fixture,true);
 const transient=await server.store.pool!.query('select count(*)::int as n from public.action_events where owner_id=$1 and lesson_id=$2 and action_id=$3',[owner,one.lesson.id,action.actionId]);assert.equal(transient.rows[0].n,0);check('queued HTTP receipt and generating SQL metadata commit without immutable transient action row');
 stage='ready publication';releaseFirst();const image=await ready(one.lesson.id,action.targetId);
 const normalized=await server.store.pool!.query('select status,prompt,purpose,fingerprint,storage_key,mime,fixture from public.illustrations where owner_id=$1 and id=$2',[owner,action.targetId]);assert.equal(normalized.rows[0].status,'ready');assert.equal(normalized.rows[0].mime,'image/png');assert.equal(normalized.rows[0].fixture,true);
 const terminal=await server.store.pool!.query('select operation,status,payload_hash from public.action_events where owner_id=$1 and lesson_id=$2 and action_id=$3',[owner,one.lesson.id,action.actionId]);assert.equal(terminal.rows.length,1);assert.equal(terminal.rows[0].status,'ready');assert.equal(terminal.rows[0].operation,'illustration.generate');assert.equal(terminal.rows[0].payload_hash,normalized.rows[0].fingerprint);check('ready image bytes stored privately and one immutable terminal action committed', {fixtureImages:1});
 stage='idempotent retry';assert.equal((await ok('POST',route,action)).status,'ready');assert.equal(providerCalls,1);check('duplicate concurrent and terminal retries invoke synthetic provider exactly once',{providerInvocations:1});
 stage='private storage access';const authorized=await call('GET',image.imageUrl);assert.equal(authorized.statusCode,200);assert.deepEqual(authorized.rawPayload,png);assert.match(String(authorized.headers['cache-control']),/no-store/);
 const token=signed.cookies[0].value,browser=createClient(local.API_URL,local.ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});assert.ok((await browser.storage.from('course-originals').download(normalized.rows[0].storage_key)).error);
 const publicLesson=await ok('GET',`/api/lessons/${one.lesson.id}`);assert.equal(JSON.stringify(publicLesson).includes(action.args.prompt),false);assert.equal('payload'in publicLesson.lesson.receipts[action.actionId],false);
 assert.equal((await server.store.pool!.query("select count(*)::int as n from public.usage where owner_id=$1 and provider='bfl'",[owner])).rows[0].n,0);check('owner image API returns exact bytes while direct browser Storage and raw prompt receipt access are denied');
 stage='single-image deletion';await ok('DELETE',`/api/lessons/${one.lesson.id}/illustrations/${action.targetId}`);
 const removed=await server.store.pool!.query('select status,prompt,purpose,fingerprint from public.illustrations where owner_id=$1 and id=$2',[owner,action.targetId]);assert.equal(removed.rows[0].status,'cancelled');assert.equal(removed.rows[0].prompt,'[Removed]');assert.equal(removed.rows[0].purpose,'[Removed]');assert.equal(removed.rows[0].fingerprint,normalized.rows[0].fingerprint);
 const privateState=await server.store.pool!.query('select state from public.learner_state where owner_id=$1',[owner]);const privateLesson=privateState.rows[0].state.lessons.find((l:any)=>l.id===one.lesson.id);assert.equal(privateLesson.receipts[action.actionId].payload.includes(action.args.prompt),false);assert.equal(JSON.parse(privateLesson.receipts[action.actionId].payload).fingerprint,normalized.rows[0].fingerprint);
 assert.equal((await call('POST',route,action)).statusCode,200);assert.equal(providerCalls,1);assert.equal((await call('GET',image.imageUrl)).statusCode,404);
 const terminalAfter=await server.store.pool!.query('select payload_hash,status from public.action_events where owner_id=$1 and lesson_id=$2 and action_id=$3',[owner,one.lesson.id,action.actionId]);assert.equal(terminalAfter.rows[0].payload_hash,terminal.rows[0].payload_hash);assert.equal(terminalAfter.rows[0].status,'ready');check('single-image delete scrubs job/receipt prompt, preserves immutable fingerprint and denies bytes without resubmission');
 stage='course purge';const nextLesson=await ok('POST','/api/lessons',{courseId:one.course.id}),next=await make(nextLesson.id,one.course.id);await ok('POST',`/api/lessons/${nextLesson.id}/actions`,next);const nextImage=await ready(nextLesson.id,next.targetId);const courseRemoved=await ok('DELETE',`/api/courses/${one.course.id}`);assert.equal(courseRemoved.revoked,true);
 assert.equal((await call('GET',nextImage.imageUrl)).statusCode,404);
 const drain=await server.app.inject({method:'POST',url:'/internal/purges/run',payload:{},headers:{origin:config.origin,authorization:`Bearer ${config.workerSecret}`}});assert.equal(drain.statusCode,200);
 assert.equal((await server.store.pool!.query('select count(*)::int as n from public.illustrations where owner_id=$1 and course_id=$2',[owner,one.course.id])).rows[0].n,0);assert.ok((await admin.storage.from('course-originals').download(ownedKeys[1])).error);check('course revoke denies reads immediately and authenticated purge worker removes metadata/private image');
 stage='account purge';const last=await setup(),lastAction=await make(last.lesson.id,last.course.id);await ok('POST',`/api/lessons/${last.lesson.id}/actions`,lastAction);await ready(last.lesson.id,lastAction.targetId);await ok('DELETE','/api/account');
 const erased=await server.store.pool!.query('select (select count(*)::int from public.illustrations where owner_id=$1) as images,(select count(*)::int from public.profiles where owner_id=$1) as profiles,(select count(*)::int from public.learner_state where owner_id=$1) as state',[owner]);assert.ok(Object.values(erased.rows[0]).every(value=>value===0));assert.ok((await admin.storage.from('course-originals').download(ownedKeys[2])).error);check('account purge removes normalized metadata, aggregate and private image bytes');
 report.passed=true;
}catch(error:any){report.passed=false;report.failureStage=stage;report.failure=error?.name==='AssertionError'?String(error.message).slice(0,400):String(error?.code??error?.name??'unclassified_error');process.exitCode=1;}
finally{
 releaseFirst();await server?.app.close();if(ownedKeys.length)await admin.storage.from('course-originals').remove(ownedKeys);if(owner)await admin.auth.admin.deleteUser(owner);
 report.syntheticProviderInvocations=providerCalls;report.checksRun=report.checks.length;report.checksPassed=report.checks.filter((entry:any)=>entry.passed).length;
 await mkdir('evals/results',{recursive:true});await writeFile('evals/results/illustration-service.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
