import test from 'node:test';
import assert from 'node:assert/strict';
import {perform} from '../src/gateway.ts';
import {emptyState,type State} from '../src/store.ts';
import type {Action} from '../../../packages/contracts/index.ts';
const dataset={kind:'graph' as const,directed:false,nodes:['A','B','C'].map(id=>({id,label:id})),edges:[{from:'A',to:'B'},{from:'B',to:'C'}]};
function state(){const s=emptyState();s.courses=[{id:'c',name:'Synthetic DSA'},{id:'other',name:'Other course'}];s.lessons=[{id:'l',courseId:'c',goal:'BFS',epoch:0,messages:[],receipts:{},attempts:[],quiet:false}];s.sources=[{id:'graph',courseId:'c',name:'synthetic.json',versionId:'v1',revision:1,hash:'a',status:'ready',storageKey:'private',skippedPages:[],passages:[],dsa:dataset}];return s;}
const action=(s:State,type:Action['type'],args:Action['args'],id=crypto.randomUUID(),revision=s.lessons[0].board?.revision??0):Action=>({actionId:id,sessionId:'l',turnEpoch:s.lessons[0].epoch,type,targetId:'board',expectedRevision:revision,args});
test('imported DSA create computes exact source-version steps; patch is in-place, idempotent and undoable',()=>{
 const s=state();const created=perform(s,action(s,'board.create',{kind:'dsa',sourceId:'graph',algorithm:'bfs'}));assert.equal(created.revision,1);assert.equal(created.board.sourceVersionId,'v1');assert.deepEqual(created.board.result.order,['A','B','C']);
 const patch=action(s,'board.patch',{stepIndex:2,showFrontier:false});const changed=perform(s,patch);assert.equal(changed.revision,2);assert.equal(changed.board.result.steps[2].currentId,'B');assert.equal(changed.board.result.showFrontier,false);assert.equal(perform(s,patch).revision,2);
 const undone=perform(s,action(s,'board.undo',{}));assert.equal(undone.revision,3);assert.equal(undone.board.result.stepIndex,0);
});
test('DSA rejects wrong-course, unavailable and unready sources, arbitrary nodes, unsafe steps and mixed chart arguments',()=>{
 for(const mutate of [(s:State)=>{s.sources[0].courseId='other';},(s:State)=>{s.sources[0].deleted=true;},(s:State)=>{s.sources[0].status='indexing';},(s:State)=>{delete s.sources[0].dsa;}]){const s=state();mutate(s);assert.throws(()=>perform(s,action(s,'board.create',{kind:'dsa',sourceId:'graph',algorithm:'bfs'})));assert.equal(s.lessons[0].board,undefined);}
 for(const args of [{kind:'dsa',algorithm:'bfs'},{kind:'dsa',sourceId:'graph',algorithm:'bfs',nodes:dataset.nodes},{kind:'dsa',sourceId:'graph',algorithm:'bfs',binCount:5}]){const s=state();assert.throws(()=>perform(s,action(s,'board.create',args)));}
 const s=state();perform(s,action(s,'board.create',{kind:'dsa',sourceId:'graph',algorithm:'bfs'}));const before=structuredClone(s.lessons[0].board);assert.throws(()=>perform(s,action(s,'board.patch',{stepIndex:99})));assert.deepEqual(s.lessons[0].board,before);assert.throws(()=>perform(s,action(s,'board.patch',{algorithm:'search',targetValue:3})));assert.deepEqual(s.lessons[0].board,before);
});
test('changing traversal resets step and uses confirmed source revision; stale turn/revision and changed payload cannot commit',()=>{
 const s=state();perform(s,action(s,'board.create',{kind:'dsa',sourceId:'graph',algorithm:'bfs',stepIndex:3}));
 const change=action(s,'board.patch',{algorithm:'dfs',startNode:'C'});perform(s,change);assert.equal(s.lessons[0].board!.result.stepIndex,0);assert.deepEqual(s.lessons[0].board!.result.order,['C','B','A']);
 assert.throws(()=>perform(s,{...change,args:{algorithm:'bfs'}}),/different change/);assert.throws(()=>perform(s,action(s,'board.patch',{stepIndex:1},crypto.randomUUID(),1)),/current version/);
 const stale=action(s,'board.patch',{stepIndex:1});s.lessons[0].epoch++;assert.throws(()=>perform(s,stale),/interrupted/);
 s.sources[0].deleted=true;assert.throws(()=>perform(s,action(s,'board.patch',{stepIndex:1})),/removed/);
});
test('replace switches requested concept without losing prior learner visual; undo restores complete kind and coordinates',()=>{
 const s=state();perform(s,action(s,'board.create',{kind:'vectors',vectorA:[2,2],vectorB:[-1,3],label:'My vectors'}));const old=structuredClone(s.lessons[0].board!);
 const replace=action(s,'board.replace',{kind:'dsa',sourceId:'graph',algorithm:'bfs',label:'Graph traversal'});const changed=perform(s,replace);assert.equal(changed.revision,2);assert.equal(changed.board.kind,'dsa');assert.equal(changed.board.vectorA,undefined);assert.equal(changed.board.history[0].label,'My vectors');assert.equal(perform(s,replace).revision,2);
 const undone=perform(s,action(s,'board.undo',{}));assert.equal(undone.revision,3);assert.equal(undone.board.kind,'vectors');assert.deepEqual(undone.board.vectorA,[2,2]);assert.deepEqual(undone.board.result,old.result);assert.equal(undone.board.algorithm,undefined);assert.equal(undone.board.sourceId,undefined);
});
test('replace validates the new source before changing board, respects revision and refuses missing current target',()=>{
 const s=state();assert.throws(()=>perform(s,action(s,'board.replace',{kind:'dsa',sourceId:'graph',algorithm:'bfs'})),/current visual/);perform(s,action(s,'board.create',{kind:'vectors',vectorA:[1,0],vectorB:[0,1]}));const before=structuredClone(s.lessons[0].board);
 assert.throws(()=>perform(s,action(s,'board.replace',{kind:'dsa',sourceId:'missing',algorithm:'bfs'})));assert.deepEqual(s.lessons[0].board,before);
 assert.throws(()=>perform(s,action(s,'board.replace',{kind:'dsa',sourceId:'graph',algorithm:'bfs'},crypto.randomUUID(),0)),/current revision/);assert.deepEqual(s.lessons[0].board,before);
});
