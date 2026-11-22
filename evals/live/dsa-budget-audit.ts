/** Read-only, local numeric audit. No provider calls, limits changes or raw content. */
import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {loadConfig} from '../../apps/api/src/config.ts';
import {Store} from '../../apps/api/src/store.ts';
import {parseUnitLimits,parseRateTable,normalizeProviderUsage,type Reservation,type Units} from '../../apps/api/src/meter.ts';
import {canonical} from '../../packages/contracts/index.ts';
import type {PoolClient} from 'pg';

const config=loadConfig(),sha=(value:string)=>createHash('sha256').update(value).digest('hex');
if(config.mode!=='live'||!config.devAuthBypass||!config.devAuthUserId||!['localhost','127.0.0.1','[::1]'].includes(new URL(config.databaseUrl!).hostname))throw Error('Audit requires the configured local test profile and loopback database.');
const history=JSON.parse(await readFile('evals/live/results/dsa-switching.json','utf8')),run=history.runs.at(-1),evidence=run.browserEvidence;
const events=(await readFile(path.resolve(config.dataDir,'live-metrics.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const started=events.filter(event=>event.name==='session_started'&&event.fixture===false&&event.runId===evidence.runDigest);
if(started.length!==1)throw Error('Audit requires one exact recorded session-start match.');
const report:any={readOnly:true,auditProviderCalls:0,historyRunNumber:run.runNumber,startedAt:run.startedAt,runDigest:evidence.runDigest,
  clientErrors:evidence.errors.map((error:any)=>({code:error.code,phase:error.phase,wallAt:error.wallAt})),completedPhases:run.phases.length,
  fullJourneyPassed:run.passed===true,config:{paidEnabled:config.paid,liveEnabled:config.live,sessionMaxSeconds:config.maxSeconds,
    ceilingUsd:Number(process.env.SPEND_CEILING_USD??7.6),liveUnitLimits:parseUnitLimits(process.env.MODEL_UNIT_LIMITS_JSON).live},
  clientUsageEvents:evidence.usage.length,clientUsageDuplicateCount:evidence.usageDuplicateCount,clientUsageInvalidCount:evidence.usageInvalidCount,
  invoiceReconciliation:'open',cumulativeCounterSemantics:'Not inferred. Distinct observations remain conservative upper-bound provisions, not invoice totals.'};
let observedText=0;report.recordedInputTextCrossings=[];
for(const [index,event]of evidence.usage.entries()){
  const amount=(event.inputModalities??[]).filter((item:any)=>item.modality==='TEXT').reduce((sum:number,item:any)=>sum+item.tokenCount,0),before=observedText;
  observedText+=amount;const limit=report.config.liveUnitLimits.input.TEXT;
  if(before<=limit&&observedText>limit)report.recordedInputTextCrossings.push({eventOrdinal:index+1,phase:event.phase,before,eventAmount:amount,after:observedText,configuredLimit:limit,excess:observedText-limit,wallAt:event.wallAt});
}
report.recordedAttributedInputText=observedText;
const textRate=parseRateTable(process.env.MODEL_UNIT_PRICES_JSON)?.models[config.liveModel]?.input.TEXT;
report.configurationReviewOnly={notApplied:true,currentInputTextCap:report.config.liveUnitLimits.input.TEXT,proposedInputTextCap:160000,
  additionalMaximumInputTextUsd:typeof textRate==='number'?(160000-report.config.liveUnitLimits.input.TEXT)*textRate/1000000:null,
  unchangedOtherUnitAndDollarCeilings:true,requiresManualPassReview:true,doesNotPromiseNineTurnCompletion:true};
report.enforcementScope={unitSum:'one live reservation across all provider reconnects',frozenLimit:'reservation.limits.input.TEXT',configuration:'MODEL_UNIT_LIMITS_JSON.live.input.TEXT',
  persistedBlock:'metering.passes[reservation.passId].blockedReason',consequence:'active pass blocks further paid admission and heartbeat until reviewed; no reset performed'};
const store=new Store(config);store.pool!.options.connectionTimeoutMillis=1500;let client:PoolClient|undefined;
try{
  client=await store.pool!.connect();await client.query('BEGIN READ ONLY');await client.query('SET LOCAL ROLE tutor_api');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[config.devAuthUserId]);await client.query("SET LOCAL statement_timeout='3s'");
  const keys=await client.query<{id:string;meter_id:string|null}>("select r.key as id,r.value->>'meterId' as meter_id from public.learner_state s cross join lateral jsonb_each(s.state->'reservations') r where s.owner_id=$1",[config.devAuthUserId]);
  const matches=keys.rows.filter(row=>sha(row.meter_id??row.id)===started[0].meterId);if(matches.length!==1)throw Error('Audit requires one exact hashed reservation match.');
  const selected=await client.query<{reservation:Reservation;pass:any;remaining_seconds:string}>("select state->'reservations'->$2::text as reservation, (state->'metering'->'passes')->(state->'reservations'->$2::text->>'passId') as pass,state->>'remainingSeconds' as remaining_seconds from public.learner_state where owner_id=$1",[config.devAuthUserId,matches[0].id]);
  const {reservation:r,pass,remaining_seconds}=selected.rows[0];await client.query('ROLLBACK');
  const records=Object.values(r.usageRecords??{}),byDigest=new Map(records.map(record=>[sha(record.eventId),record]));
  const ordered=evidence.usage.map((event:any)=>({event,record:byDigest.get(event.eventIdDigest)}));
  const zero=():Units=>({input:{TEXT:0,AUDIO:0,IMAGE:0},output:{TEXT:0,AUDIO:0,IMAGE:0},cachedInput:{TEXT:0,AUDIO:0,IMAGE:0}}),sum=zero();
  const fingerprints=new Set<string>();let repeatedRaw=0;const crossings:any[]=[],unmatched={input:0,output:0,thoughts:0,cached:0};
  for(let index=0;index<ordered.length;index++){
    const {event,record}=ordered[index];if(!record)throw Error('A client usage event has no persisted matching record.');
    const fingerprint=sha(canonical(record.providerMetadata));if(fingerprints.has(fingerprint))repeatedRaw++;fingerprints.add(fingerprint);
    const normalized=normalizeProviderUsage(record.providerMetadata,r.kind??'live',r.pricing?.rates);
    if(canonical(normalized.units)!==canonical(record.units))throw Error('Stored normalized units do not match the frozen-rate normalization.');
    for(const key of['input','output','thoughts','cached'] as const)unmatched[key]+=record.unmatchedCounts?.[key]??0;
    if(record.units)for(const direction of['input','output','cachedInput'] as const)for(const modality of['TEXT','AUDIO','IMAGE'] as const){
      const before=sum[direction][modality],amount=record.units[direction][modality],limit=r.limits?.[direction][modality];sum[direction][modality]+=amount;
      if(limit!==undefined&&before<=limit&&sum[direction][modality]>limit)crossings.push({eventOrdinal:index+1,phase:event.phase,turnEpoch:event.turnEpoch,turnSequence:event.turnSequence,direction,modality,before,eventAmount:amount,after:sum[direction][modality],limit,excess:sum[direction][modality]-limit,wallAt:event.wallAt});
    }
  }
  const recordSumUsd=records.reduce((total,item)=>total+(item.usd??0),0);
  report.reservation={matched:true,settled:r.settled,seconds:r.seconds,activeSeconds:r.activeSeconds??null,remainingSeconds:Number(remaining_seconds),unknownCost:r.unknownCost??false,
    estimatedUsd:r.estimatedUsd??null,recordSumUsd:Number(recordSumUsd.toFixed(10)),maximumUsd:r.maxUsd,heldUsd:r.heldUsd,usageEventCount:records.length,
    limits:r.limits,units:sum,unmatchedCounts:unmatched,reasonCounts:Object.fromEntries([...new Set(records.map(item=>item.reason??'strict'))].map(reason=>[reason,records.filter(item=>(item.reason??'strict')===reason).length])),
    eventIdentityUnique:byDigest.size===records.length,allClientEventsMatched:ordered.every((row:any)=>Boolean(row.record)),exactRepeatedRawUsageFingerprints:repeatedRaw,
    estimateEqualsSingleSum:Math.abs((r.estimatedUsd??0)-recordSumUsd)<1e-8};
  report.pass={spentUsd:pass.spentUsd,heldUsd:pass.heldUsd,ceilingUsd:pass.ceilingUsd,unknownCost:pass.unknownCost,blockedReason:pass.blockedReason??null,conservativeProvisionUsd:pass.conservativeProvisionUsd};
  report.firstUnitCeilingCrossings=crossings;report.costCeilingExceeded=pass.spentUsd+pass.heldUsd>Math.min(pass.ceilingUsd,report.config.ceilingUsd)+1e-10;
  report.cause=pass.blockedReason??'no_current_block_recorded';report.noDuplicateSettlementCharge=report.reservation.estimateEqualsSingleSum&&records.length===evidence.usage.length;
}catch(error:any){await client?.query('ROLLBACK').catch(()=>{});report.auditUnavailable=true;report.failureCode=typeof error?.code==='string'&&/^[A-Z0-9_]{1,30}$/.test(error.code)?error.code:'read_only_audit_unavailable';}
finally{client?.release();await store.close();}
await writeFile('evals/live/results/dsa-switching-budget.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(report.auditUnavailable)process.exitCode=2;
