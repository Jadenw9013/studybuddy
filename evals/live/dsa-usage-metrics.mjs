// File-only audit. No database, provider, app service or media access.
import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const reportPath='evals/live/results/dsa-voice.json';
const history=JSON.parse(await readFile(reportPath,'utf8'));
const metrics=(await readFile(path.resolve(process.env.DATA_DIR??'.data','live-metrics.jsonl'),'utf8')).trim().split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
const fields=['at','turnEpoch','turnSequence','promptTokenCount','responseTokenCount','totalTokenCount','cachedContentTokenCount',
  'inputTextTokens','inputAudioTokens','inputImageTokens','outputTextTokens','outputAudioTokens'];
const summaries=[];
for(const run of history.runs.slice(0,2)){
  const seen=new Set(),events=[];let duplicates=0;
  for(const event of metrics.filter(e=>e.name==='usage'&&e.fixture===false&&e.runId===run.browserEvidence?.runDigest)){
    if(typeof event.eventId!=='string'||!/^[a-f0-9]{64}$/.test(event.eventId))continue;
    if(seen.has(event.eventId)){duplicates++;continue;}seen.add(event.eventId);
    events.push({eventIdDigest:event.eventId,...Object.fromEntries(fields.map(field=>[
      field,typeof event[field]==='number'&&Number.isFinite(event[field])&&event[field]>=0?event[field]:null,
    ]))});
  }
  run.posthocUsageMetrics={source:'existing sanitized operational metrics; no provider calls',uniqueEventCount:events.length,duplicateEventCount:duplicates,events,
    limitation:'Flattened observed modality counters; missing thought/cache detail cannot be recovered. Periodic or cumulative events are not distinct-call invoices. No paid usage was invented or reconciled.'};
  summaries.push({runStartedAt:run.startedAt,uniqueEventCount:events.length,duplicateEventCount:duplicates});
}
if(process.argv.includes('--annotate'))await writeFile(reportPath,JSON.stringify(history,null,2));
console.log(JSON.stringify({fileOnly:true,annotated:process.argv.includes('--annotate'),runs:summaries}));
