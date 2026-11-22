/** The real Google SDK runs against an in-memory transport. No socket/provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate as immediate} from 'node:timers/promises';
import Ajv from 'ajv';
import {GoogleGenAI,Behavior,Modality} from '@google/genai';
import {tutorTools} from '../src/tools.ts';
import {voiceLessonContext} from '../src/voice-context.ts';
import {emptyState,readyLessonSources,lessonContextBoard,type State} from '../src/store.ts';
import {perform} from '../src/gateway.ts';
import {validateVisualProposal,type VisualProposal} from '../../../packages/tutor/index.ts';
import type {DsaAlgorithm} from '../../../packages/board/dsa.ts';

async function fixtures(){
 const s=emptyState();s.courses=[{id:'f1000000-0000-4000-8000-000000000001',name:'Synthetic selected DSA notebook'}];s.lessons=[{id:'f2000000-0000-4000-8000-000000000001',courseId:s.courses[0].id,goal:'Use the requested structure',epoch:0,messages:[],receipts:{},attempts:[],quiet:false}];
 for(const [i,name] of ['01-undirected-graph.json','02-directed-graph.json','03-binary-tree.json','04-binary-search-tree.json'].entries()){
  const data=JSON.parse(await readFile(new URL('../../../fixtures/dsa/'+name,import.meta.url),'utf8'));
  s.sources.push({id:`d${i}000000-0000-4000-8000-000000000001`,versionId:`e${i}000000-0000-4000-8000-000000000001`,courseId:s.courses[0].id,name,hash:'a'.repeat(64),revision:1,status:'ready',passages:[],skippedPages:[],storageKey:'private-synthetic',dsa:data.structure});
 }
 return s;
}
function input(s:State){const l=s.lessons[0];return{question:'Use the requested graph/tree operation.',goal:l.goal,board:lessonContextBoard(s,l),attempts:[],notebook:[],passages:[],dsaSources:readyLessonSources(s,l).map(source=>({sourceId:source.id,name:source.name,dsa:source.dsa!}))};}
function invoke(s:State,type:VisualProposal['type'],args:VisualProposal['args']){
 const l=s.lessons[0],tool=tutorTools(false,voiceLessonContext(s,l)).find(tool=>tool.name===type)!;
 assert.equal(new Ajv({strict:false}).compile(tool.parametersJsonSchema as object)(args),true,'valid transition must fit the exact current Live declaration');
 validateVisualProposal({type,args},input(s));
 return perform(s,{actionId:crypto.randomUUID(),sessionId:l.id,turnEpoch:l.epoch,type,targetId:l.board?.id??'board',expectedRevision:l.board?.revision??0,args},'model');
}

test('selected-notebook Live contract executes graph A → binary-tree inorder → BST search 7 without stale roots or steps',async()=>{
 const s=await fixtures(),[graph,,tree,bst]=s.sources;
 const created=invoke(s,'board.create',{kind:'dsa',sourceId:graph.id,algorithm:'bfs',startNode:'A',stepIndex:0});assert.equal(created.board.result.steps[0].currentId,null);
 invoke(s,'board.patch',{stepIndex:1});invoke(s,'board.patch',{algorithm:'dfs',stepIndex:0});
 const treeResult=invoke(s,'board.replace',{kind:'dsa',sourceId:tree.id,algorithm:'inorder',stepIndex:0});assert.equal(treeResult.board.startNode,undefined);assert.equal(treeResult.board.result.rootId,'n1');assert.deepEqual(treeResult.board.result.order,['n4','n2','n5','n1','n6','n3','n7']);
 invoke(s,'board.patch',{stepIndex:1});
 const search=invoke(s,'board.replace',{kind:'dsa',sourceId:bst.id,algorithm:'search',targetValue:7,stepIndex:0});assert.equal(search.board.startNode,undefined);assert.equal(search.board.result.rootId,'n8');assert.deepEqual(search.board.result.order,['n8','n3','n6','n7']);
 const found=invoke(s,'board.patch',{stepIndex:search.board.result.steps.length-1});assert.equal(found.board.result.foundId,'n7');
 const missing=invoke(s,'board.patch',{targetValue:5});assert.equal(missing.board.result.stepIndex,0);assert.deepEqual(missing.board.result.order,['n8','n3','n6','n4']);
 const last=invoke(s,'board.patch',{stepIndex:missing.board.result.steps.length-1});assert.equal(last.board.result.steps.at(-1).action,'not_found');assert.equal(last.board.result.foundId,null);assert.equal(last.board.id,created.board.id);assert.equal(last.board.revision,9);
});

test('every supported algorithm on all four exact fixture structures passes both omitted-root and explicit-root create/replace contracts',async()=>{
 const original=await fixtures();let checked=0;
 for(const selected of original.sources){
  const algorithms:DsaAlgorithm[]=selected.dsa!.kind==='graph'?['bfs','dfs']:['bfs','dfs','inorder','preorder','postorder',...(selected.dsa!.kind==='bst'?['search' as const]:[])];
  for(const algorithm of algorithms)for(const explicitRoot of [false,true])for(const replacing of [false,true]){
   const s=structuredClone(original);if(replacing)invoke(s,'board.create',{kind:'dsa',sourceId:s.sources[0].id,algorithm:'dfs',startNode:'A'});
   const args={kind:'dsa',sourceId:selected.id,algorithm,stepIndex:0,showFrontier:true,...(explicitRoot?{startNode:selected.dsa!.rootId}:{}),...(algorithm==='search'?{targetValue:7}:{})};
   const result=invoke(s,replacing?'board.replace':'board.create',args);assert.equal(result.board.sourceVersionId,selected.versionId);assert.equal(result.board.result.algorithm,algorithm);assert.equal(result.board.result.stepIndex,0);
   const terminal=invoke(s,'board.patch',{stepIndex:result.board.result.steps.length-1});assert.equal(new Set(terminal.board.result.order).size,terminal.board.result.order.length);checked++;
  }
 }
 assert.equal(checked,60);
});

test('deselected sources, stale graph roots, mixed fields and inappropriate algorithms produce bounded trusted failure codes',async()=>{
 const s=await fixtures(),graph=s.sources[0],tree=s.sources[2];invoke(s,'board.create',{kind:'dsa',sourceId:graph.id,algorithm:'dfs',startNode:'A'});
 for(const proposal of [
  {type:'board.replace',args:{kind:'dsa',sourceId:tree.id,algorithm:'inorder',startNode:'A'}},
  {type:'board.patch',args:{algorithm:'inorder'}},
  {type:'board.replace',args:{kind:'dsa',sourceId:tree.id,algorithm:'inorder',stepIndex:'0'}},
  {type:'board.replace',args:{kind:'binary_tree',sourceId:tree.id,algorithm:'inorder'}},
  {type:'board.replace',args:{kind:'dsa',sourceId:tree.id,algorithm:'inorder',mode:'count'}},
  {type:'board.patch',args:{mode:'count'}},
  {type:'board.patch',args:{sourceId:tree.id,algorithm:'inorder'}},
 ] as VisualProposal[])assert.throws(()=>validateVisualProposal(proposal,input(s)),(error:any)=>error.code==='invalid_params'&&error.status===400);
 for(const [proposal,path,keyword] of [
  [{type:'board.replace',args:{kind:'dsa',sourceId:tree.id,algorithm:'inorder',startNode:'A'}},'/args/startNode','enum'],
  [{type:'board.patch',args:{algorithm:'inorder'}},'/args/algorithm','enum'],
  [{type:'board.patch',args:{mode:'count'}},'/args/mode','additionalProperties'],
  [{type:'board.patch',args:{sourceId:tree.id,algorithm:'inorder'}},'/args/sourceId','additionalProperties'],
  [{type:'board.patch',args:{stepIndex:99}},'/args/stepIndex','maximum'],
 ] as [VisualProposal,string,string][])assert.throws(()=>validateVisualProposal(proposal,input(s)),(error:any)=>error.validationDiagnostics?.[0]?.path===path&&error.validationDiagnostics[0].keyword===keyword&&!JSON.stringify(error.validationDiagnostics).includes(tree.id));
 s.lessons[0].selectedSourceIds=[graph.id];const context=voiceLessonContext(s,s.lessons[0]);assert.deepEqual(context.dsaSources.map((source:any)=>source.sourceId),[graph.id]);
 const schema=tutorTools(false,context).find(tool=>tool.name==='board.replace')!.parametersJsonSchema as object,args={kind:'dsa',sourceId:tree.id,algorithm:'inorder'};assert.equal(new Ajv({strict:false}).compile(schema)(args),false);
 assert.throws(()=>validateVisualProposal({type:'board.replace',args},input(s)),(error:any)=>error.code==='insufficient_evidence');
 assert.throws(()=>perform(s,{actionId:crypto.randomUUID(),sessionId:s.lessons[0].id,turnEpoch:0,type:'board.replace',targetId:s.lessons[0].board!.id,expectedRevision:1,args},'model'),(error:any)=>error.code==='source_not_selected'&&error.status===403);
});

test('actual Google Live SDK preserves narrowed schemas, source/root metadata and typed tool error responses without network',async()=>{
 const s=await fixtures(),context=voiceLessonContext(s,s.lessons[0]),tools=tutorTools(false,context).map(tool=>({...tool,behavior:Behavior.NON_BLOCKING}));
 let realHttpCalls=0,factoryConnections=0,transportCallbacks:any;const sent:any[]=[],received:any[]=[];
 const client=new GoogleGenAI({vertexai:false,enterprise:false,apiKey:'synthetic-serialization-only',httpOptions:{baseUrl:'https://sdk-serialization.invalid',fetch:async()=>{realHttpCalls++;throw Error('HTTP transport forbidden in offline SDK test');}}});
 // Pinned SDK seam: only the socket factory is replaced. Its real setup,
 // server-message conversion and tool-response serialization still execute.
 (client.live as any).webSocketFactory={create:(_url:string,_headers:unknown,callbacks:any)=>{transportCallbacks=callbacks;return{connect(){factoryConnections++;queueMicrotask(()=>callbacks.onopen());},send(raw:string){const value=JSON.parse(raw);sent.push(value);if(value.setup)queueMicrotask(()=>callbacks.onmessage({data:JSON.stringify({setupComplete:{}})}));},close(){}};}};
 const session=await client.live.connect({model:'gemini-3.8-live',config:{responseModalities:[Modality.AUDIO],tools:[{functionDeclarations:tools}]},callbacks:{onmessage:message=>received.push(message)}});
 try{
  const serialized=sent[0].setup.tools[0].functionDeclarations;
  for(const name of ['board.create','board.replace','board.patch']){const declared=tools.find(tool=>tool.name===name)!,wire=serialized.find((tool:any)=>tool.name===name);assert.deepEqual(wire.parametersJsonSchema,declared.parametersJsonSchema);assert.equal(wire.behavior,'NON_BLOCKING');}
  const replacement=serialized.find((tool:any)=>tool.name==='board.replace');assert.deepEqual(replacement.parametersJsonSchema.properties.sourceId.enum,s.sources.map(source=>source.id));assert.deepEqual(replacement.parametersJsonSchema.properties.kind.enum,['dsa']);
  for(const source of s.sources)assert.ok(replacement.description.includes(JSON.stringify({rootId:source.dsa!.rootId}).slice(1,-1)));
  const args={kind:'dsa',sourceId:s.sources[2].id,algorithm:'inorder',stepIndex:0};transportCallbacks.onmessage({data:JSON.stringify({toolCall:{functionCalls:[{id:'synthetic-switch',name:'board.replace',args}]}})});await immediate();
  assert.deepEqual(received.find(message=>message.toolCall)?.toolCall.functionCalls[0].args,args);
  const response={error:{code:'invalid_params',message:'Choose a node from the new source.',validationDiagnostics:[{path:'/args/startNode',keyword:'enum',actualType:'string'}]},retryable:true};
  session.sendToolResponse({functionResponses:[{id:'synthetic-switch',name:'board.replace',response}]});
  assert.deepEqual(sent.at(-1).toolResponse.functionResponses[0],{id:'synthetic-switch',name:'board.replace',response});
  assert.equal(realHttpCalls,0);assert.equal(factoryConnections,1);
 }finally{session.close();}
});
