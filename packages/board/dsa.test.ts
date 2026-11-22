import test from 'node:test';
import assert from 'node:assert/strict';
import {dsaAnalysis,validateDsaDataset,type DsaDataset} from './dsa.ts';
const graph:DsaDataset={kind:'graph',directed:false,nodes:['A','B','C','D','E','Z'].map(id=>({id,label:id})),edges:[{from:'A',to:'B'},{from:'A',to:'C'},{from:'B',to:'C'},{from:'B',to:'D'},{from:'C',to:'E'},{from:'E',to:'A'}]};
const tree:DsaDataset={kind:'bst',directed:true,rootId:'n4',nodes:[4,2,6,1,3,5,7].map(value=>({id:'n'+value,label:String(value),value})),edges:[{from:'n4',to:'n2',side:'left'},{from:'n4',to:'n6',side:'right'},{from:'n2',to:'n1',side:'left'},{from:'n2',to:'n3',side:'right'},{from:'n6',to:'n5',side:'left'},{from:'n6',to:'n7',side:'right'}]};
test('BFS handles cycles, disconnected nodes, undirected reverse edges and exact FIFO frontier',()=>{
 const result=dsaAnalysis(graph,{algorithm:'bfs',startNode:'A',stepIndex:2});
 assert.deepEqual(result.order,['A','B','C','E','D']);assert.deepEqual(result.steps[1].frontierIds,['B','C','E']);assert.deepEqual(result.steps[2].frontierIds,['C','E','D']);assert.deepEqual(result.steps[2].visitedIds,['A','B']);assert.equal(result.reachableCount,5);assert.equal(result.totalNodes,6);
 assert.deepEqual(dsaAnalysis(graph,{algorithm:'bfs',startNode:'D'}).order,['D','B','A','C','E']);
});
test('DFS matches depth-first neighbor order even with cross edges; next frontier element is actual next visited',()=>{
 const result=dsaAnalysis(graph,{algorithm:'dfs'});assert.deepEqual(result.order,['A','B','C','E','D']);
 for(let i=1;i<result.steps.length-1;i++)assert.equal(result.steps[i].frontierIds[0],result.steps[i+1].currentId);
 assert.ok(result.steps.some(step=>step.action==='skip_visited'));assert.ok(result.steps.some(step=>new Set(step.frontierIds).size<step.frontierIds.length));
 for(let i=1;i<result.steps.length;i++)if(result.steps[i].action==='skip_visited')assert.deepEqual(result.steps[i].visitedIds,result.steps[i-1].visitedIds);
 assert.equal(new Set(result.order).size,result.order.length);
 const permuted={...graph,edges:[...graph.edges].reverse()};assert.deepEqual(dsaAnalysis(permuted,{algorithm:'dfs'}).order,result.order);
});
test('directed traversal never follows incoming edges',()=>{
 const directed={...graph,directed:true};assert.deepEqual(dsaAnalysis(directed,{algorithm:'bfs',startNode:'D'}).order,['D']);assert.deepEqual(dsaAnalysis(directed,{algorithm:'bfs',startNode:'A'}).order,['A','B','C','D','E']);
});
test('tree traversals obey structural child slots rather than node/edge array order',()=>{
 const reordered={...tree,nodes:[...tree.nodes].reverse(),edges:[...tree.edges].reverse()};
 assert.deepEqual(dsaAnalysis(reordered,{algorithm:'inorder'}).order,['n1','n2','n3','n4','n5','n6','n7']);
 assert.deepEqual(dsaAnalysis(reordered,{algorithm:'preorder'}).order,['n4','n2','n1','n3','n6','n5','n7']);
 assert.deepEqual(dsaAnalysis(reordered,{algorithm:'postorder'}).order,['n1','n3','n2','n5','n7','n6','n4']);
 const layout=dsaAnalysis(reordered,{algorithm:'inorder'});assert.equal(layout.frontierKind,'recursion-stack');for(const n of layout.nodes){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));assert.ok(n.x>=0&&n.x<=1000&&n.y>=0&&n.y<=600);}
});
test('BST search follows comparisons, honestly reports absent targets and reveals found only at selected step',()=>{
 const ready=dsaAnalysis(tree,{algorithm:'search',targetValue:5,stepIndex:0});assert.equal(ready.foundId,null);assert.equal(ready.steps[0].currentId,null);assert.deepEqual(ready.steps[0].visitedIds,[]);assert.deepEqual(ready.steps[0].frontierIds,['n4']);assert.match(ready.steps[0].explanation,/No node has been visited or compared/);assert.match(ready.steps[0].explanation,/next candidate is 4/);
 const found=dsaAnalysis(tree,{algorithm:'search',targetValue:5,stepIndex:3});assert.deepEqual(found.order,['n4','n6','n5']);assert.equal(found.foundId,'n5');assert.equal(found.steps[3].action,'found');assert.equal(dsaAnalysis(tree,{algorithm:'search',targetValue:5,stepIndex:1}).foundId,null);
 const absent=dsaAnalysis(tree,{algorithm:'search',targetValue:8,stepIndex:3});assert.deepEqual(absent.order,['n4','n6','n7']);assert.equal(absent.foundId,null);assert.equal(absent.steps[3].action,'not_found');assert.deepEqual(absent.steps[3].frontierIds,[]);
});
test('rejects global BST violations, duplicate child slots, multiple parents, disconnected cycle and invalid references',()=>{
 const bad=structuredClone(tree);bad.nodes.find(n=>n.id==='n3')!.value=8;assert.throws(()=>validateDsaDataset(bad),/ancestor/);
 for(const mutate of [(d:DsaDataset)=>d.edges.push({...d.edges[0]}),(d:DsaDataset)=>{d.edges[1].side='left';},(d:DsaDataset)=>{d.edges[0].to='missing';},(d:DsaDataset)=>{d.nodes[0].value=NaN;},(d:DsaDataset)=>{d.directed=false;}]){const d=structuredClone(tree);mutate(d);assert.throws(()=>validateDsaDataset(d));}
 const disconnected:DsaDataset={kind:'binary_tree',directed:true,rootId:'A',nodes:['A','B','C'].map(id=>({id,label:id})),edges:[{from:'B',to:'C',side:'left'},{from:'C',to:'B',side:'left'}]};assert.throws(()=>validateDsaDataset(disconnected),/reachable/);
});
test('bounded options, algorithms, starts, steps and values fail closed; singleton layouts remain finite',()=>{
 assert.throws(()=>dsaAnalysis(graph,{algorithm:'inorder'}));assert.throws(()=>dsaAnalysis(tree,{algorithm:'search'}));assert.throws(()=>dsaAnalysis(tree,{algorithm:'search',targetValue:Infinity}));assert.throws(()=>dsaAnalysis(graph,{startNode:'missing'}));assert.throws(()=>dsaAnalysis(graph,{stepIndex:99}));assert.throws(()=>dsaAnalysis(tree,{algorithm:'inorder',startNode:'n2'}));
 const singleton=dsaAnalysis({kind:'binary_tree',directed:true,rootId:'A',nodes:[{id:'A',label:'A'}],edges:[]},{algorithm:'inorder'});assert.deepEqual(singleton.order,['A']);assert.equal(singleton.nodes[0].y,300);
});
test('31-node skew tree and BST expand their trusted canvas so node inspection outlines never overlap or clip',()=>{
 for(const kind of ['binary_tree','bst'] as const){
  const skew:DsaDataset={kind,directed:true,rootId:'n0',nodes:Array.from({length:31},(_,value)=>({id:'n'+value,label:String(value),value})),edges:Array.from({length:30},(_,i)=>({from:'n'+i,to:'n'+(i+1),side:'right' as const}))};
  const result=dsaAnalysis(skew,{algorithm:'inorder'});assert.equal(result.nodes.length,31);assert.ok(result.bounds.width>1000&&result.bounds.height>600);
  // 84 is the largest renderer inspection-box diameter across supported node
  // sizes. Check rectangular exclusion, stronger than circle center distance.
  const diameter=84,half=diameter/2;
  for(let i=0;i<result.nodes.length;i++){
   const a=result.nodes[i];assert.ok(a.x>=half&&a.x+half<=result.bounds.width&&a.y>=half&&a.y+half<=result.bounds.height,'inspection outline stays inside the computed bounds');
   for(const b of result.nodes.slice(i+1))assert.ok(Math.abs(a.x-b.x)>=diameter||Math.abs(a.y-b.y)>=diameter,`inspection boxes for ${a.id}/${b.id} must not intersect`);
  }
 }
});
test('second source boundary rejects unsupported upload shapes, self-loops, graph child slots and model-authored positions',()=>{
 for(const mutate of [(d:any)=>{d.nodes[0].id='0invalid';},(d:any)=>{d.nodes[0].label='x'.repeat(61);},(d:any)=>{d.edges.push({from:'A',to:'A'});},(d:any)=>{d.edges[0].side='left';},(d:any)=>{d.nodes[0].x=42;},(d:any)=>{d.permissions=['execute'];}]){const d=structuredClone(graph);mutate(d);assert.throws(()=>validateDsaDataset(d));}
});
