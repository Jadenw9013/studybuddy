import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dsaStepIntent} from './dsa-intent.ts';
import {dsaAnalysis,type DsaDataset} from '../board/dsa.ts';
const bst:DsaDataset=JSON.parse(readFileSync(new URL('../../fixtures/dsa/04-binary-search-tree.json',import.meta.url),'utf8')).structure;
function board(stepIndex=0){return{id:'board',kind:'dsa',sourceId:'bst-source',sourceVersionId:'bst-v1',algorithm:'search',targetValue:7,stepIndex,result:dsaAnalysis(bst,{algorithm:'search',targetValue:7,stepIndex})};}

test('narrow next-step grammar recognizes both actual polite requests and punctuation-free transcription without changing source or target',()=>{
 for(const question of ['Next step only, please. Say one brief sentence about this comparison.','Next step, please. Show only that step and say one short sentence.','Next step only please say one brief sentence about this comparison','Please show me the next step.','Advance one step.','next']){
  const intent=dsaStepIntent(question,board())!;assert.equal(intent.kind,'next');assert.equal(intent.currentStepIndex,0);assert.equal(intent.expectedStepIndex,1);assert.equal(intent.sourceId,'bst-source');assert.equal(intent.algorithm,'search');assert.equal(intent.targetValue,7);assert.deepEqual(intent.proposal,{type:'board.patch',args:{stepIndex:1}});
 }
});
test('previous and restart preserve the selected BST search and clamp legal boundary steps',()=>{
 for(const question of ['Previous step please.','Go back one step.','Please go to the previous step. Explain this comparison briefly.'])assert.equal(dsaStepIntent(question,board(2))!.expectedStepIndex,1);
 for(const question of ['Restart this search.','Restart the traversal.','Start over.','Restart from the beginning.'])assert.equal(dsaStepIntent(question,board(2))!.expectedStepIndex,0);
 const last=board().result.steps.length-1;assert.equal(dsaStepIntent('next step',board(last))!.expectedStepIndex,last);assert.equal(dsaStepIntent('previous step',board(0))!.expectedStepIndex,0);
});
test('mixed source/algorithm/target requests and ambiguous language are not guessed as existing-visual navigation',()=>{
 for(const question of ['Next step, then switch to BFS.','Next step on 03-binary-tree.json.','Next step and search for 5.','Next step. Now explain BFS.','Show the next step of inorder traversal.','Restart BFS.','Explain why the next comparison goes left.','What is a next step?','Next step twice.','Go forward two steps.','Do not go to the next step.','Next step? Or restart?','Next step\nExplain BFS','Next step (algorithm=bfs)','Next step. Show only that step and say one short sentence about graph A.'])assert.equal(dsaStepIntent(question,board()),undefined,question);
 assert.equal(dsaStepIntent('next step',{kind:'vectors'}),undefined);assert.equal(dsaStepIntent({question:'next step',goal:'BFS'},board()),undefined);
});
test('bounded current-step metadata works without future steps; inconsistent or out-of-range confirmed state fails closed',()=>{
 const full=board(1),packed={...full,result:{algorithm:'search',stepIndex:1,stepCount:full.result.steps.length,currentStep:full.result.steps[1]}};
 assert.equal(dsaStepIntent('next step',packed)!.expectedStepIndex,2);
 for(const value of [{...packed,stepIndex:2},{...packed,result:{...packed.result,stepCount:0}},{...packed,result:{...packed.result,stepIndex:-1}},{...packed,result:{...packed.result,stepIndex:50}},{...packed,sourceId:''},{...packed,targetValue:undefined,result:{...packed.result,targetValue:undefined}}])assert.throws(()=>dsaStepIntent('next step',value),(error:any)=>error.code==='invalid_state');
});
