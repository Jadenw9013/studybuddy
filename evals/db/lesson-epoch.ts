/** Root-run local Postgres probe. Creates only isolated synthetic rows; no provider calls. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import {Store,DomainError} from '../../apps/api/src/store.ts';
import {loadConfig} from '../../apps/api/src/config.ts';

const local=JSON.parse((await readFile('.data/supabase-local-status.json','utf8')).replace(/^\uFEFF/,''));
if(!['localhost','127.0.0.1'].includes(new URL(local.DB_URL).hostname))throw Error('This probe runs only against local synthetic Postgres.');
const store=new Store(loadConfig({APP_MODE:'live',NODE_ENV:'test',DATABASE_URL:local.DB_URL,SUPABASE_URL:local.API_URL,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,WS_TICKET_SECRET:'synthetic-epoch-probe-not-used',INTERNAL_WORKER_SECRET:'synthetic-epoch-probe-not-used',PAID_CALLS_ENABLED:'false'}));
const admin=new pg.Pool({connectionString:local.DB_URL,max:2,statement_timeout:5000});
const owner=randomUUID(),other=randomUUID(),course=randomUUID(),lesson=randomUUID();
const report:{kind:string;providerSessions:number;humanParticipants:number;checks:{name:string;passed:boolean}[];checksPassed?:number;checksRun?:number;checksPlanned:number;passed?:boolean;failure?:string;lookupTiming?:object}={kind:'real-local-postgres-synthetic-epoch-read',providerSessions:0,humanParticipants:0,checks:[],checksPlanned:7};
const check=(name:string)=>report.checks.push({name,passed:true});
const unavailable=(ownerId=owner,id=lesson)=>assert.rejects(store.readLessonEpoch(ownerId,id),(error:unknown)=>error instanceof DomainError&&error.status===404);
try{
 await admin.query('insert into auth.users(id,email) values ($1,$2),($3,$4)',[owner,`epoch-${owner}@example.test`,other,`epoch-${other}@example.test`]);
 await admin.query('insert into public.profiles(owner_id) values ($1),($2)',[owner,other]);
 await admin.query('insert into public.courses(owner_id,id,title) values ($1,$2,$3)',[owner,course,'Synthetic packet epoch course']);
 await admin.query('insert into public.lessons(owner_id,course_id,id,turn_epoch) values ($1,$2,$3,0)',[owner,course,lesson]);
 assert.equal(await store.readLessonEpoch(owner,lesson),0);check('normalized lesson epoch zero is readable without a learner_state aggregate');
 await unavailable(other);await unavailable(owner,randomUUID());check('cross-owner and unknown lesson reads fail closed under tutor_api RLS');

 const writer=await admin.connect();let read:Promise<number>|undefined;
 try{
  await writer.query('begin');
  await writer.query('update public.lessons set turn_epoch=1 where owner_id=$1 and id=$2',[owner,lesson]);
  // A SELECT FOR UPDATE regression would wait on this deliberately held row lock.
  // Release the writer before awaiting any timed-out read during cleanup.
  read=store.readLessonEpoch(owner,lesson);let timer:ReturnType<typeof setTimeout>|undefined;
  try{assert.equal(await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Normalized epoch read waited for an uncommitted row writer')),2000);})]),0);}finally{clearTimeout(timer);}
  await writer.query('commit');
 }finally{await writer.query('rollback');writer.release();await read?.catch(()=>{});}
 assert.equal(await store.readLessonEpoch(owner,lesson),1);check('plain read observes prior committed epoch during concurrent writer, then fresh epoch after commit');

 await admin.query('update public.lessons set deleted_at=now() where owner_id=$1 and id=$2',[owner,lesson]);await unavailable();
 await admin.query('update public.lessons set deleted_at=null where owner_id=$1 and id=$2',[owner,lesson]);
 await admin.query('update public.courses set deleted_at=now() where owner_id=$1 and id=$2',[owner,course]);await unavailable();
 await admin.query('update public.courses set deleted_at=null where owner_id=$1 and id=$2',[owner,course]);
 check('lesson and parent-course tombstones immediately revoke future reads');

 const durations:number[]=[];
 for(let i=0;i<20;i++){const start=performance.now();assert.equal(await store.readLessonEpoch(owner,lesson),1);durations.push(performance.now()-start);}
 durations.sort((a,b)=>a-b);const percentile=(p:number)=>Number(durations[Math.ceil(p*durations.length)-1].toFixed(3));
 report.lookupTiming={label:'20 sequential synthetic local normalized Store reads; not provider audio or learner latency',denominator:20,unit:'ms',p50:percentile(.5),p95:percentile(.95)};
 check('repeated normalized lookups retain owner context and return confirmed epoch');

 const aggregates=await admin.query('select count(*)::int as n from public.learner_state where owner_id=any($1::uuid[])',[[owner,other]]);
 assert.equal(aggregates.rows[0].n,0);check('packet reads never create learner_state rows');
 await admin.query('delete from public.profiles where owner_id=$1',[owner]);await unavailable();check('account profile cascade revokes lesson lookup without a cached permission');
 report.passed=true;
}catch(error:any){report.passed=false;report.failure=error instanceof DomainError?`${error.code} (${error.status})`:error?.code?`Local probe failed (${String(error.code).replace(/[^A-Za-z0-9_]/g,'').slice(0,30)})`:'Synthetic epoch assertion failed; rerun locally to inspect the failing assertion.';process.exitCode=1;
}finally{
 try{await admin.query('delete from auth.users where id=any($1::uuid[])',[[owner,other]]);}finally{await store.close();await admin.end();}
 report.checksPassed=report.checks.filter(item=>item.passed).length;report.checksRun=report.checks.length;
 await mkdir('evals/results',{recursive:true});await writeFile('evals/results/lesson-epoch.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
