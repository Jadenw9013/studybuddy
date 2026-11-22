import test from 'node:test';
import assert from 'node:assert/strict';
import {visualCreation,type VisualSource} from './visual-creation.ts';
const csv:VisualSource={id:'my-table',name:'my-counts.csv',status:'ready',dataset:{numericColumns:['positive','negative'],rows:[{positive:'8',negative:'2'},{positive:'12',negative:'78'}]}};
test('vectors and reviewed probability need no CSV; statistics plots fail clearly without one',()=>{
  assert.equal(visualCreation({kind:'vectors',vectorA:[2,2],vectorB:[-1,3]},[]).ready,true);
  assert.equal(visualCreation({kind:'probability',sourceId:'reviewed'},[]).ready,true);
  for(const kind of ['histogram','regression'] as const){const creation=visualCreation({kind},[]);assert.equal(creation.ready,false);assert.match(creation.message!,/Upload a ready CSV/);}
});
test('selected probability CSV is honored and reviewed counts cannot replace it silently',()=>{
  const result=visualCreation({kind:'probability',sourceId:csv.id,xColumn:'positive',yColumn:'negative'},[csv]);
  assert.deepEqual(result.args,{kind:'probability',sourceId:csv.id,xColumn:'positive',yColumn:'negative',conditioning:'row0'});assert.equal('cells'in result.args!,false);
});
test('indexing, removed selection and unsupported numeric inputs cannot create a misleading plot',()=>{
  assert.equal(visualCreation({kind:'histogram'},[{...csv,status:'indexing'}]).ready,false);
  assert.equal(visualCreation({kind:'histogram',sourceId:'removed'},[csv]).ready,false);
  assert.equal(visualCreation({kind:'regression',sourceId:csv.id,xColumn:'positive',yColumn:'positive'},[csv]).ready,false);
  assert.equal(visualCreation({kind:'probability',sourceId:csv.id},[{...csv,dataset:{...csv.dataset!,rows:[{positive:'NaN',negative:'2'},{positive:'12',negative:'78'}]}}]).ready,false);
});

const graph:VisualSource={id:'uploaded-graph',name:'my-graph.json',status:'ready',dsa:{kind:'graph',directed:false,nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'a',to:'b'}]}};
const bst:VisualSource={id:'uploaded-bst',name:'my-tree.json',status:'ready',dsa:{kind:'bst',directed:true,rootId:'root',nodes:[{id:'root',label:'Root',value:7},{id:'left',label:'Left',value:3},{id:'right',label:'Right',value:9}],edges:[{from:'root',to:'left',side:'left'},{from:'root',to:'right',side:'right'}]}};
test('DSA creation uses the selected ready uploaded structure and typed traversal arguments',()=>{
  const result=visualCreation({kind:'dsa',sourceId:graph.id,algorithm:'dfs',startNode:'b'},[graph,bst]);
  assert.equal(result.ready,true);
  assert.deepEqual(result.args,{kind:'dsa',sourceId:graph.id,algorithm:'dfs',startNode:'b',stepIndex:0,showFrontier:true});
  for(const sources of [[],[csv],[{...graph,status:'indexing'}]])assert.equal(visualCreation({kind:'dsa'},sources).ready,false);
  assert.equal(visualCreation({kind:'dsa',sourceId:'removed'},[graph]).ready,false);
});
test('tree-only algorithms and BST targets are validated before a creation request',()=>{
  assert.equal(visualCreation({kind:'dsa',sourceId:graph.id,algorithm:'inorder'},[graph]).ready,false);
  assert.equal(visualCreation({kind:'dsa',sourceId:bst.id,algorithm:'search'},[bst]).ready,false);
  assert.equal(visualCreation({kind:'dsa',sourceId:bst.id,algorithm:'search',targetValue:Infinity},[bst]).ready,false);
  assert.equal(visualCreation({kind:'dsa',sourceId:bst.id,algorithm:'inorder',startNode:'left'},[bst]).ready,false);
  const search=visualCreation({kind:'dsa',sourceId:bst.id,algorithm:'search',targetValue:9},[bst]);
  assert.equal(search.ready,true);assert.equal(search.args?.targetValue,9);assert.equal(search.args?.startNode,'root');
});
