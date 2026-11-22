/** Real local Postgres + pinned BGE probe on developer-authored synthetic cases.
 * This is not the reviewed held-out release set or a tutoring-provider result.
 */
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import pg from 'pg';
import {EMBEDDING_REVISION,indexPassages,retrieve} from '../../packages/tutor/retrieval.ts';

const root=process.cwd(), py=process.env.PYTHON_PATH??path.join(root,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
process.env.BGE_CACHE_DIR??=path.join(root,'.data/model-cache');
const owner=randomUUID(),other=randomUUID(),course=randomUUID(),wrongCourse=randomUUID(),otherCourse=randomUUID();
type Doc={key:string;owner:string;course:string;source:string;version:string;revision:number;name:string;current:boolean;passages:any[]};
const parse=(name:string)=>JSON.parse(execFileSync(py,['apps/worker/parser.py',`fixtures/${name}`],{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
const docs:Doc[]=[];
function addDoc(key:string,name:string,passages:any[],opts:Partial<Doc>={}){
 const doc:Doc={key,name,owner,course,source:randomUUID(),version:randomUUID(),revision:1,current:true,passages,...opts};
 doc.passages=passages.map((p,index)=>({...p,id:randomUUID(),key:p.key??`${key}:${index}`,docKey:key}));docs.push(doc);return doc;
}
const lecture=addDoc('lecture','lecture.pdf',parse('lecture.pdf').passages.map((p:any)=>({...p,key:`lecture:page${p.locator.pageIndex+1}`})),{revision:2});
addDoc('notebook','attempt.ipynb',parse('attempt.ipynb').passages.map((p:any)=>({...p,key:`notebook:${p.locator.cellId}`})));
addDoc('csv','scores.csv',parse('scores.csv').passages.map((p:any)=>({...p,key:'csv:scores'})));
addDoc('probability','conditional-probability.txt',[
 {key:'probability:positive',text:'Conditional probability changes the denominator to the conditioning group. Among positive cases there are 8 true positives and 12 false positives. P(condition given positive) is 8 divided by 20, or 0.4. Do not divide by all 100 cases.',locator:{lineStart:1,lineEnd:1}},
 {key:'probability:condition',text:'P(positive given condition) uses all cases with the condition: 8 true positives and 2 false negatives. Divide 8 by 10 to obtain 0.8. This reverses the conditional event from condition given positive.',locator:{lineStart:2,lineEnd:2}},
 {key:'probability:zero',text:'When the conditioning group has zero cases, conditional probability is undefined. Do not divide by zero or claim that the probability is zero.',locator:{lineStart:3,lineEnd:3}},
]);
addDoc('regression','linear-regression.txt',[
 {key:'regression:fit',text:'For study hours x=[0,1,2,3] and scores y=[5,7,9,11], the fitted line is score=5+2*hours. The slope is 2 score units per additional hour and the intercept is 5 score units at zero hours. At 2.5 hours the prediction is 10 score units.',locator:{lineStart:1,lineEnd:1}},
 {key:'regression:constant',text:'A linear regression slope is undefined if every x value is the same. Zero x variance provides no information about the change in y per unit change in x. A constant x column must not be reported as a valid fitted slope.',locator:{lineStart:2,lineEnd:2}},
 {key:'regression:causality',text:'An association between study time and exam score does not establish causality. A fitted regression line alone cannot prove that studying caused the score change; confounding and study design matter.',locator:{lineStart:3,lineEnd:3}},
]);
const densityText=lecture.passages.find(p=>p.key==='lecture:page2').text;
addDoc('stale','lecture.pdf',[{text:densityText+' Earlier conflicting version: use another rule.',locator:{pageIndex:1},key:'forbidden:stale'}],{source:lecture.source,version:randomUUID(),revision:1,current:false});
addDoc('wrong-course','lecture.pdf',[{text:densityText,locator:{pageIndex:1},key:'forbidden:wrong-course'}],{course:wrongCourse});
addDoc('other-owner','lecture.pdf',[{text:densityText,locator:{pageIndex:1},key:'forbidden:other-owner'}],{owner:other,course:otherCourse});

const cases=[
 {id:'histogram-area',topic:'histogram',query:'What does the area of a density histogram bar represent?',expected:['lecture:page2']},
 {id:'histogram-mismatch',topic:'histogram',query:'Why does my histogram peak at 3 instead of 0.03?',expected:['lecture:page2']},
 {id:'histogram-intervals',topic:'histogram',query:'Which interval includes the final score of 40?',expected:['lecture:page1']},
 {id:'notebook-setting',topic:'histogram',query:'Which density argument is used in my ax.hist plotting cell?',expected:['notebook:plot1']},
 {id:'probability-positive',topic:'probability',query:'What is the denominator for condition given a positive result?',expected:['probability:positive']},
 {id:'probability-reverse',topic:'probability',query:'What is the probability of positive given the condition?',expected:['probability:condition']},
 {id:'probability-zero',topic:'probability',query:'What happens when the conditioning group contains zero cases?',expected:['probability:zero']},
 {id:'csv-locator',topic:'histogram',query:'Which score rows contain 0, 5, 10, 15, 20, 25, 30, 35, and 40?',expected:['csv:scores']},
 {id:'regression-prediction',topic:'regression',query:'What score does the fitted line predict at two and a half study hours?',expected:['regression:fit']},
 {id:'regression-slope',topic:'regression',query:'What does a slope of 2 score units per hour mean?',expected:['regression:fit']},
 {id:'regression-constant',topic:'regression',query:'Can I fit a slope when every x observation is identical?',expected:['regression:constant']},
 {id:'regression-causality',topic:'regression',query:'Does a line fitted to study hours and scores establish causality?',expected:['regression:causality']},
];
const times=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{n:sorted.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1]??null,p95Ms:sorted[Math.ceil(sorted.length*.95)-1]??null};};
const embeddingStart=performance.now();
const embedded=JSON.parse(execFileSync(py,['apps/worker/embeddings.py'],{input:JSON.stringify({namespace:randomUUID(),passages:docs.flatMap(d=>d.passages)}),encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
assert.equal(embedded.embeddingRevision,EMBEDDING_REVISION);assert.ok(embedded.passages.length);
const embeddingMs=performance.now()-embeddingStart;
const queryStart=performance.now();
const queries=JSON.parse(execFileSync(py,['apps/worker/embeddings.py','--queries'],{input:JSON.stringify({queries:cases.map(c=>c.query)}),encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}));
assert.equal(queries.embeddingRevision,EMBEDDING_REVISION);assert.equal(queries.embeddings.length,cases.length);
const queryEmbeddingMs=performance.now()-queryStart;
const byId=new Map(embedded.passages.map((p:any)=>[p.id,p]));
const byDoc=(key:string)=>embedded.passages.filter((p:any)=>p.docKey===key);
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres',max:1,connectionTimeoutMillis:5000});
const client=await pool.connect();
const indexTimes:number[]=[],lexicalTimes:number[]=[],hybridTimes:number[]=[];const outcomes:any[]=[];
let postgresVersion='unknown';
try{
 await client.query('begin');
 postgresVersion=(await client.query('show server_version')).rows[0].server_version;
 for(const id of [owner,other]){
  await client.query('insert into auth.users(id,email) values($1,$2)',[id,`retrieval-${id}@example.test`]);
  await client.query('insert into public.learner_state(owner_id,state) values($1,$2)',[id,{}]);
  await client.query('insert into public.profiles(owner_id) values($1)',[id]);
 }
 for(const [id,actor] of [[course,owner],[wrongCourse,owner],[otherCourse,other]])await client.query('insert into public.courses(owner_id,id,title) values($1,$2,$3)',[actor,id,'Synthetic retrieval fixture']);
 const sources=new Set<string>();
 for(const d of docs){
  const key=`${d.owner}/${d.source}`;
  if(!sources.has(key)){sources.add(key);await client.query('insert into public.sources(owner_id,course_id,id) values($1,$2,$3)',[d.owner,d.course,d.source]);}
  await client.query(`insert into public.source_versions(owner_id,course_id,source_id,id,source_revision,content_hash,mime_type,original_name,storage_key,indexing_state)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[d.owner,d.course,d.source,d.version,d.revision,'a'.repeat(64),'text/plain',d.name,`${d.owner}/${d.course}/${d.source}/${d.version}`,'ready']);
  if(d.current)await client.query('update public.sources set current_version_id=$4 where owner_id=$1 and course_id=$2 and id=$3',[d.owner,d.course,d.source,d.version]);
 }
 await client.query('set constraints all immediate');
 // Every insert now uses the same role/subject contract as the real API.
 await client.query('set local role tutor_api');
 for(const actor of [other,owner]){
  await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
  for(let repetition=0;repetition<(actor===owner?5:1);repetition++){
   const start=performance.now();
   for(const d of docs.filter(d=>d.owner===actor))await indexPassages(client,{ownerId:d.owner,courseId:d.course,sourceId:d.source,versionId:d.version,passages:byDoc(d.key)});
   if(actor===owner)indexTimes.push(performance.now()-start);
  }
 }
 const allowed=docs.filter(d=>d.owner===owner&&d.course===course&&d.current).map(d=>d.version);
 for(let i=0;i<cases.length;i++){
  const item=cases[i];let start=performance.now();
  const lexical=await retrieve(client,owner,course,allowed,item.query);lexicalTimes.push(performance.now()-start);
  start=performance.now();const hybrid=await retrieve(client,owner,course,allowed,item.query,queries.embeddings[i]);hybridTimes.push(performance.now()-start);
  const keys=(rows:any[])=>rows.map(row=>{const p:any=byId.get(row.id);assert.ok(p);assert.ok(!p.key.startsWith('forbidden:'));assert.ok(allowed.includes(row.versionId));return p.key;});
  const lexicalKeys=keys(lexical),hybridKeys=keys(hybrid);
  outcomes.push({id:item.id,topic:item.topic,expected:item.expected,lexicalKeys,hybridKeys,
    lexicalRecallAt4:item.expected.some(key=>lexicalKeys.includes(key)),hybridRecallAt4:item.expected.some(key=>hybridKeys.includes(key))});
 }
 const crossOwner=await retrieve(client,other,otherCourse,docs.filter(d=>d.owner===other).map(d=>d.version),'density',queries.embeddings[0]);assert.equal(crossOwner.length,0);
 const summarize=(mode:'lexical'|'hybrid')=>({correct:outcomes.filter(o=>o[`${mode}RecallAt4`]).length,total:outcomes.length,latency:times(mode==='lexical'?lexicalTimes:hybridTimes)});
 const result={generatedAt:new Date().toISOString(),kind:'real_local_postgres_and_pinned_bge_synthetic_engineering_probe',
   releaseHeldOut:false,reviewer:'developer-authored, not instructor reviewed',environment:{platform:os.platform(),arch:os.arch(),node:process.version,postgres:postgresVersion,transport:'local TCP; no provider/network tutoring turn'},
   model:{name:embedded.embeddingModel,revision:EMBEDDING_REVISION,dimensions:384,tokenLimit:embedded.passages[0].tokenLimit,specialTokens:embedded.passages[0].specialTokens},
   corpus:{documents:docs.length,passages:embedded.passages.length,decoyKinds:['same-owner wrong-course','stale source version','other owner'],sourceKinds:['real generated PDF extraction','real notebook extraction','real CSV extraction','synthetic probability/regression notes']},
   embedding:{documentBatches:1,documentWallMs:embeddingMs,queryBatches:1,queryCount:cases.length,queryWallMs:queryEmbeddingMs,includesColdModelProcessStartup:true},
   indexing:times(indexTimes),lexical:summarize('lexical'),hybrid:summarize('hybrid'),
   isolation:{queryCount:cases.length*2,forbiddenCitations:0,crossOwnerAttempts:1,crossOwnerDisclosures:0},outcomes,
   limits:['Recall@4 against developer-authored locator labels is not final-claim support accuracy.','Twelve synthetic questions are not the 30-question reviewed release set.','Local SQL timings exclude user speech, provider inference, rendering, and WAN.','Indexing repeats use the same tiny corpus and transaction, not full-course production upload latency.']};
 await mkdir('evals/results',{recursive:true});await writeFile('evals/results/retrieval.json',JSON.stringify(result,null,2));
 console.log(`Real BGE/Postgres synthetic recall@4: lexical ${result.lexical.correct}/${cases.length}; hybrid ${result.hybrid.correct}/${cases.length}; forbidden citations 0/${cases.length*2}; cross-owner disclosures 0/1. Report evals/results/retrieval.json. All fixture rows rolled back.`);
}finally{
 await client.query('rollback').catch(()=>{});client.release();await pool.end();
}
