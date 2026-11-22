import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fuseRankings,retrieve,vectorLiteral,lexicalQuery} from './retrieval.ts';

test('RRF compares lexical-only and hybrid rankings with deterministic tie order',()=>{
  assert.deepEqual(fuseRankings(['notation','density','decoy'],[]).map(x=>x.id),['notation','density','decoy']);
  assert.deepEqual(fuseRankings(['notation','density','decoy'],['density','paraphrase','notation']).map(x=>x.id),['density','notation','paraphrase','decoy']);
  assert.equal(fuseRankings(['same','same'],['same']).length,1);
});
test('embedding dimension, finite values and zero-norm validation fail closed',()=>{
  assert.throws(()=>vectorLiteral([1,2]));
  assert.throws(()=>vectorLiteral(Array(384).fill(0)));
  assert.throws(()=>vectorLiteral([NaN,...Array(383).fill(1)]));
  assert.ok(vectorLiteral([1,...Array(383).fill(0)]).startsWith('[1,0,'));
});
test('SQL filters owner, course and allowed version list before lexical and vector ranks',async()=>{
  const calls:any[]=[];
  const client={query:async(sql:string,values:any[])=>{calls.push({sql,values});return{rows:[{passage_id:'p1',source_id:'s1',version_id:'v1',exact_text:'density equals count divided by observations and width',locator:{pageIndex:1}}]};}} as any;
  const rows=await retrieve(client,'owner','course',['v1'],'density',[1,...Array(383).fill(0)]);
  assert.equal(calls.length,2);
  for(const call of calls){assert.match(call.sql,/owner_id=\$1 and course_id=\$2 and version_id=any\(\$3::uuid\[\]\)/);assert.deepEqual(call.values.slice(0,3),['owner','course',['v1']]);}
  assert.equal(rows[0].passageId,'p1');assert.equal(rows[0].locator.pageIndex,1);
  assert.equal(rows.length,1);
});
test('no allowed current versions returns no citations and executes no query',async()=>{
  const client={query:()=>{throw Error('must not execute');}} as any;
  assert.deepEqual(await retrieve(client,'owner','course',[],'density'),[]);
});
test('natural mismatch question ranks a union without requiring absent learner words',()=>{
  const query=lexicalQuery('Why does my histogram peak at 3 instead of 0.03?');
  assert.equal(query,'why OR does OR my OR histogram OR peak OR at OR 3 OR instead OR of OR 0 OR 03');
  assert.equal(lexicalQuery('density density OR count; DROP TABLE lessons; --'),'density OR count OR drop OR table OR lessons');
  assert.equal(lexicalQuery('"density" -count'),'density OR count');
});
