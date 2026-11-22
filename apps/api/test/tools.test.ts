import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {tutorTools} from '../src/tools.ts';
import {voiceLessonContext} from '../src/voice-context.ts';
import {emptyState} from '../src/store.ts';
import {perform} from '../src/gateway.ts';
import {validateVisualProposal} from '../../../packages/tutor/index.ts';
import type {Action} from '../../../packages/contracts/index.ts';

test('four imported mock structures survive voice packing and a DFS graph can be replaced with the exact binary tree for inorder',async()=>{
 const state=emptyState();state.courses=[{id:'course',name:'Synthetic tool transition'}];state.lessons=[{id:'lesson',courseId:'course',goal:'Explain BFS',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];
 for(const [i,name] of ['01-undirected-graph.json','02-directed-graph.json','03-binary-tree.json','04-binary-search-tree.json'].entries()){
  const data=JSON.parse(await readFile(new URL('../../../fixtures/dsa/'+name,import.meta.url),'utf8'));
  state.sources.push({id:'source'+i,courseId:'course',versionId:'version'+i,name,hash:'synthetic',revision:1,status:'ready',storageKey:'private-synthetic',passages:[],skippedPages:[],dsa:data.structure});
 }
 const lesson=state.lessons[0];
 const action=(type:Action['type'],args:Action['args']):Action=>({actionId:crypto.randomUUID(),sessionId:lesson.id,turnEpoch:0,type,targetId:'board',expectedRevision:lesson.board?.revision??0,args});
 perform(state,action('board.create',{kind:'dsa',sourceId:'source0',algorithm:'dfs',startNode:'A',stepIndex:1}));
 const context=voiceLessonContext(state,lesson);
 assert.deepEqual(context.dsaSources.map((s:any)=>s.dsa.kind),['graph','graph','binary_tree','bst']);
 assert.deepEqual(context.dsaSources.map((s:any)=>[s.dsa.nodes.length,s.dsa.edges.length]),[[7,7],[7,7],[7,6],[9,8]]);
 const tools=tutorTools(false,{board:lesson.board,dsaSources:context.dsaSources}),declaration=tools.find(tool=>tool.name==='board.replace')!;
 const validateDeclaration=new Ajv({strict:false}).compile(declaration.parametersJsonSchema as object);
 const input={question:'Show the binary tree using inorder',goal:lesson.goal,board:lesson.board,attempts:[],notebook:[],passages:[],dsaSources:context.dsaSources};
 const correct={kind:'dsa',sourceId:'source2',algorithm:'inorder',stepIndex:0};
 const packedSchema=new Ajv({strict:false}).compile(tutorTools(false,context).find(tool=>tool.name==='board.replace')!.parametersJsonSchema as object);
 assert.equal(packedSchema(correct),true);assert.equal(packedSchema({...correct,mode:'count'}),false);
 assert.equal(validateDeclaration(correct),true);validateVisualProposal({type:'board.replace',args:correct},input);
 const replaced=perform(state,action('board.replace',correct));assert.equal(replaced.board.sourceId,'source2');assert.equal(replaced.board.sourceVersionId,'version2');assert.deepEqual(replaced.board.result.order,['n4','n2','n5','n1','n6','n3','n7']);assert.equal(replaced.board.result.stepIndex,0);
 // These broad declaration-valid mistakes must remain denied by the trusted
 // boundary. Clarified descriptions help the provider choose correct arguments;
 // they do not convert an invalid request into an authorized change.
 for(const [type,args] of [
  ['board.replace',{kind:'dsa',sourceId:'source2',algorithm:'inorder',startNode:'A',stepIndex:0}],
  ['board.patch',{algorithm:'inorder',stepIndex:0}],
  ['board.replace',{kind:'dsa',sourceId:'source2',algorithm:'inorder',mode:'count'}],
 ] as const){
  const validator=new Ajv({strict:false}).compile(tools.find(tool=>tool.name===type)!.parametersJsonSchema as object);assert.equal(validator(args),true);
  const original=structuredClone(state);original.lessons[0].board=input.board;
  assert.throws(()=>{validateVisualProposal({type,args},input);perform(original,{...action(type,args),expectedRevision:input.board!.revision});});
 }
});

test('contextual live declarations remain ordinary closed object schemas without excluding non-DSA sources or adding schema alternatives',()=>{
 const tools=tutorTools(true,{board:{kind:'dsa',sourceId:'graph'},dsaSources:[{sourceId:'tree',name:'Synthetic tree',dsa:{kind:'binary_tree',rootId:'root'}}]});
 assert.ok(tools.some(tool=>tool.name==='notebook.propose'));
 for(const tool of tools){const schema=tool.parametersJsonSchema as any;assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.equal(schema.anyOf,undefined);assert.equal(schema.oneOf,undefined);}
 for(const name of ['board.create','board.replace']){
  const schema=tools.find(tool=>tool.name===name)!.parametersJsonSchema as any;assert.equal(schema.properties.sourceId.enum,undefined);
  const validate=new Ajv({strict:false}).compile(schema);assert.equal(validate({kind:'histogram',sourceId:'another-ready-csv',column:'score'}),true);
 }
});

const dsaOnlyContext={board:{kind:'dsa',sourceId:'graph'},dsaSources:[
 {sourceId:'graph',name:'Synthetic graph',dsa:{kind:'graph' as const,rootId:'A'}},
 {sourceId:'tree',name:'Synthetic tree',dsa:{kind:'binary_tree' as const,rootId:'root'}},
],materials:[{sourceId:'graph',kind:'dsa'},{sourceId:'tree',kind:'dsa'},{sourceId:'guide',kind:'document'}],materialsTotal:3,datasets:[],notebook:[]};

test('complete DSA-only live inventory narrows source and argument schemas while allowing a correct cross-source inorder replacement',()=>{
 const tools=tutorTools(false,dsaOnlyContext),ajv=new Ajv({strict:false});
 for(const name of ['board.create','board.replace']){
  const schema=tools.find(tool=>tool.name===name)!.parametersJsonSchema as any,validate=ajv.compile(schema);
  const correct={kind:'dsa',sourceId:'tree',algorithm:'inorder',stepIndex:0};assert.equal(validate(correct),true);
  for(const args of [
   {...correct,mode:'count'},{...correct,vectorA:[2,2]},{...correct,column:'value'},
   {...correct,kind:'binary_tree'},{...correct,sourceId:'unknown'},
   {kind:'dsa',sourceId:'tree'},{kind:'dsa',algorithm:'inorder'},
  ])assert.equal(validate(args),false,`unsupported argument shape cannot enter the narrowed ${name} declaration`);
  assert.equal(schema.anyOf,undefined);assert.equal(schema.oneOf,undefined);
 }
 const patch=ajv.compile(tools.find(tool=>tool.name==='board.patch')!.parametersJsonSchema as object);
 assert.equal(patch({stepIndex:1}),true);assert.equal(patch({algorithm:'inorder',stepIndex:0}),true);
 for(const args of [{sourceId:'tree'},{kind:'dsa'},{binCount:5},{mode:'count'}])assert.equal(patch(args),false);
 const graph={kind:'graph' as const,directed:false,rootId:'A',nodes:[{id:'A',label:'A'}],edges:[]};
 const tree={kind:'binary_tree' as const,directed:true,rootId:'root',nodes:[{id:'root',label:'Root'},{id:'left',label:'Left'}],edges:[{from:'root',to:'left',side:'left' as const}]};
 const state=emptyState();state.courses=[{id:'course',name:'Synthetic DSA transition'}];state.lessons=[{id:'lesson',courseId:'course',goal:'Switch trees',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];
 state.sources=[['graph',graph],['tree',tree]].map(([id,dsa])=>({id:id as string,name:id+'.json',courseId:'course',versionId:id+'-v1',hash:'synthetic',revision:1,status:'ready',storageKey:'private-synthetic',passages:[],skippedPages:[],dsa:dsa as typeof graph|typeof tree}));
 const make=(type:Action['type'],args:Action['args']):Action=>({actionId:crypto.randomUUID(),sessionId:'lesson',turnEpoch:0,type,targetId:'board',expectedRevision:state.lessons[0].board?.revision??0,args});
 perform(state,make('board.create',{kind:'dsa',sourceId:'graph',algorithm:'dfs',startNode:'A'}));
 const context={question:'Show inorder on the binary tree',goal:'Switch trees',board:state.lessons[0].board,attempts:[],passages:[],notebook:[],dsaSources:state.sources.map(source=>({sourceId:source.id,name:source.name,dsa:source.dsa!}))};
 assert.throws(()=>validateVisualProposal({type:'board.replace',args:{kind:'dsa',sourceId:'tree',algorithm:'inorder',startNode:'A'}},context));
 const args={kind:'dsa',sourceId:'tree',algorithm:'inorder',stepIndex:0};validateVisualProposal({type:'board.replace',args},context);
 const committed=perform(state,make('board.replace',args));assert.equal(committed.board.sourceId,'tree');assert.deepEqual(committed.board.result.order,['left','root']);
});

test('mixed, paired, incompletely packed or non-DSA active lessons keep every original general live tool schema',()=>{
 const baseline=tutorTools(false).map(tool=>tool.parametersJsonSchema);
 for(const context of [
  {...dsaOnlyContext,datasets:[{sourceId:'csv'}]},
  {...dsaOnlyContext,notebook:[{sourceId:'book'}]},
  {...dsaOnlyContext,materials:[...dsaOnlyContext.materials,{sourceId:'csv',kind:'dataset'}],materialsTotal:4},
  {...dsaOnlyContext,materials:[...dsaOnlyContext.materials,{sourceId:'book',kind:'notebook'}],materialsTotal:4},
  {...dsaOnlyContext,materialsTotal:4},
  {...dsaOnlyContext,materialsTotal:undefined},
  {...dsaOnlyContext,notebook:undefined},
  {...dsaOnlyContext,datasets:undefined},
  {...dsaOnlyContext,dsaSources:dsaOnlyContext.dsaSources.slice(0,1)},
  {...dsaOnlyContext,board:{kind:'vectors'}},
  {...dsaOnlyContext,pairedNotebook:{cellId:'paired'}},
 ])assert.deepEqual(tutorTools(false,context).map(tool=>tool.parametersJsonSchema),baseline);
 const paired=tutorTools(true,dsaOnlyContext);assert.deepEqual(paired.filter(tool=>!tool.name?.startsWith('notebook.')).map(tool=>tool.parametersJsonSchema),baseline);
 const graphOnly={...dsaOnlyContext,board:undefined,dsaSources:dsaOnlyContext.dsaSources.slice(0,1),materials:dsaOnlyContext.materials.filter(source=>source.sourceId!=='tree'),materialsTotal:2};
 const schema=tutorTools(false,graphOnly).find(tool=>tool.name==='board.create')!.parametersJsonSchema as object,validate=new Ajv({strict:false}).compile(schema);
 assert.equal(validate({kind:'dsa',sourceId:'graph',algorithm:'bfs'}),true);assert.equal(validate({kind:'dsa',sourceId:'graph',algorithm:'inorder'}),false);
});
