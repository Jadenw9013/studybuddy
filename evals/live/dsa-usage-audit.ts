/** Read-only local audit: never calls Store.transact, a provider, or an HTTP mutation. */
import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadConfig} from '../../apps/api/src/config.ts';
import {Store,type State} from '../../apps/api/src/store.ts';
import path from 'node:path';
import type {PoolClient} from 'pg';
import type {Reservation} from '../../apps/api/src/meter.ts';

const config=loadConfig();
if(config.mode!=='live'||!config.devAuthBypass||!config.devAuthUserId||!['localhost','127.0.0.1','[::1]'].includes(new URL(config.databaseUrl!).hostname))
  throw Error('Read-only audit is restricted to the configured local test profile and loopback database.');
const history=JSON.parse(await readFile('evals/live/results/dsa-voice.json','utf8'));
const events=(await readFile(path.resolve(config.dataDir,'live-metrics.jsonl'),'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const store=new Store(config);
// A short connection deadline avoids leaving a blocked diagnostic running.
store.pool!.options.connectionTimeoutMillis=5000;
let client:PoolClient|undefined;
try{
  client=await store.pool!.connect();await client.query('BEGIN READ ONLY');
  await client.query('SET LOCAL ROLE tutor_api');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[config.devAuthUserId]);
  await client.query("SET LOCAL statement_timeout='5s'");
  const selected=await client.query<{state:State}>('select state from public.learner_state where owner_id=$1',[config.devAuthUserId]);
  const state=selected.rows[0]?.state;if(!state)throw Error('Configured local test profile was not found.');
  const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
  const out=[];
  for(const run of history.runs.slice(0,2)){
    const started=events.find(e=>e.name==='session_started'&&e.fixture===false&&e.runId===run.browserEvidence?.runDigest);
    const matches=Object.entries(state.reservations).filter(([id,r])=>started&&sha(r.meterId??id)===started.meterId);
    if(matches.length!==1){out.push({runStartedAt:run.startedAt,uniqueReservationMatch:false});continue;}
    const [reservationId,rawReservation]=matches[0],reservation=rawReservation as Reservation;
    const lesson=state.lessons.find(l=>l.id===reservation.lessonId),course=state.courses.find(c=>c.id===lesson?.courseId);
    const sources=state.sources.filter(s=>s.courseId===course?.id),lessons=state.lessons.filter(l=>l.courseId===course?.id);
    const sourceCount=sources.length,activeSourceCount=sources.filter(s=>!s.deleted).length;
    const totalMessageCount=lessons.reduce((sum,l)=>sum+l.messages.length,0),boards=lessons.filter(l=>l.board).length;
    out.push({runStartedAt:run.startedAt,uniqueReservationMatch:true,reservationId,lessonId:lesson?.id,courseId:course?.id,
      courseDeleted:course?.deleted??null,lessonDeleted:lesson?.deleted??null,sourceCount,activeSourceCount,
      lessonCount:lessons.length,totalMessageCount,boardCount:boards,
      exactEmptyActiveCourse:Boolean(course&&!course.deleted&&lesson&&!lesson.deleted&&sources.length===0&&lessons.length===1&&totalMessageCount===0&&boards===0),
      reservation:{settled:reservation.settled,activeSeconds:reservation.activeSeconds??null,usageEventCount:Object.keys(reservation.usageRecords??{}).length,
        estimatedUsd:reservation.estimatedUsd??null,unknownCost:reservation.unknownCost??false},
    });
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify({readOnly:true,matchedRuns:out},null,2));
}catch(error:any){
  await client?.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({readOnly:true,error:'local_audit_unavailable_no_raw_error_logged',
    code:/^[A-Z0-9_]{1,32}$/.test(String(error?.code))?String(error.code):null}));process.exitCode=2;
}finally{client?.release();await store.close();}
