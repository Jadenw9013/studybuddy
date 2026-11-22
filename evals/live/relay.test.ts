import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { encodeVoiceContext, registerVoice, type VoiceDependencies,type VoiceToolObservation } from '../../apps/api/src/voice.js';
import { MediaModality, type LiveConnectParameters, type LiveServerMessage, type Session } from '@google/genai';
import {DomainError} from '../../packages/contracts/index.ts';
import {validateVisualProposal} from '../../packages/tutor/index.ts';
import {dsaAnalysis,type DsaDataset} from '../../packages/board/dsa.ts';
import {perform} from '../../apps/api/src/gateway.ts';
import {emptyState,type Source} from '../../apps/api/src/store.ts';

async function until(predicate: () => boolean, label: string, timeoutMs=2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('synthetic provider connector cannot be enabled in production', async t => {
  const testEnv = process.env as Record<string, string | undefined>;
  const previous = testEnv.NODE_ENV;
  testEnv.NODE_ENV = 'production';
  t.after(() => { if (previous === undefined) delete testEnv.NODE_ENV; else testEnv.NODE_ENV = previous; });
  const app = Fastify(); t.after(() => app.close());
  await assert.rejects(registerVoice(app, dependencies({ providerConnect: async () => { throw new Error('must not connect'); } })), /only in NODE_ENV=test/);
});

test('live board tools notify UI then wait for exact painted revision; timeout and interruption never claim shown',async t=>{
  const env=process.env as Record<string,string|undefined>,previous=env.NODE_ENV;env.NODE_ENV='test';
  t.after(()=>{if(previous===undefined)delete env.NODE_ENV;else env.NODE_ENV=previous;});
  const app=Fastify();t.after(()=>app.close());let epoch=0,paintedRevision=0;
  let board:any={id:'owned-board',kind:'vectors',revision:1,vectorA:[1,0],vectorB:[0,1],result:{dot:0}};
  const sessions:{params:LiveConnectParameters;responses:any[];context:any[]}[]=[],messages:any[]=[];
  await registerVoice(app,dependencies({
    config:{enabled:true,apiKey:'synthetic-not-a-credential',model:'gemini-3.8-live',origin,ticketSecret:'b'.repeat(64)},
    currentEpoch:async()=>epoch,interrupt:async()=>++epoch,snapshot:async()=>({board,paintedRevision}),
    reserve:async(_u,_l,id)=>({id,seconds:1200}),settle:async()=>{},
    tools:[{name:'board.patch',parametersJsonSchema:{type:'object',properties:{label:{type:'string'}}}}],
    executeTool:async()=>{board={...board,revision:board.revision+1};return{status:'saved',objectId:board.id,revision:board.revision,board};},
    providerConnect:async params=>{
      const session={params,responses:[] as any[],context:[] as any[]};sessions.push(session);
      return{close(){},sendClientContent(value:any){session.context.push(value);},sendRealtimeInput(){},sendToolResponse(value:any){session.responses.push(value);}} as unknown as Session;
    },
  }));
  const ticket=(await app.inject({method:'POST',url:'/api/lessons/synthetic-lesson/live-ticket',headers:{origin}})).json();
  const ws=await app.injectWS(ticket.wsPath,{headers:{origin}},{onInit:socket=>socket.on('message',raw=>messages.push(JSON.parse(raw.toString())))});
  t.after(()=>ws.terminate());await until(()=>messages.some(m=>m.state==='listening'),'initial provider');
  const emit=(id:string)=>sessions[0].params.callbacks!.onmessage({toolCall:{functionCalls:[{id,name:'board.patch',args:{label:'DSA demonstration'}}]}} as unknown as LiveServerMessage);
  emit('painted');await until(()=>messages.some(m=>m.type==='tool'),'client notified before provider result');
  assert.equal(sessions[0].responses.length,0);
  sessions[0].params.callbacks!.onmessage({serverContent:{turnComplete:true}} as unknown as LiveServerMessage);
  await until(()=>messages.filter(m=>m.state==='listening').length>=2,'provider queue remains active while paint is pending');
  assert.equal(sessions[0].responses.length,0);
  paintedRevision=2;ws.send(JSON.stringify({type:'metric',name:'board_render_proxy',revision:1}));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(sessions[0].responses.length,0,'stale ack is rejected');
  ws.send(JSON.stringify({type:'metric',name:'board_render_proxy',revision:2}));
  await until(()=>sessions[0].responses.length===1,'paint-confirmed tool response');
  assert.equal(sessions[0].responses[0].functionResponses[0].response.result.display.status,'shown');
  assert.equal(sessions[0].context.filter(c=>JSON.stringify(c).includes('App render receipt:')).length,0,'ack is consumed once, without a duplicate model turn');
  sessions[0].params.callbacks!.onmessage({serverContent:{turnComplete:true}} as unknown as LiveServerMessage);
  sessions[0].params.callbacks!.onmessage({serverContent:{inputTranscription:{text:'Change the next visual.'}}} as unknown as LiveServerMessage);
  await until(()=>messages.some(m=>m.type==='caption'&&m.text==='Change the next visual.'),'next learner request');
  emit('not-painted');await until(()=>messages.filter(m=>m.type==='tool').length===2,'second client visual');
  await until(()=>sessions[0].responses.length===2,'bounded paint timeout',6500);
  assert.equal(sessions[0].responses[1].functionResponses[0].response.result.display.status,'computed_not_displayed');
  sessions[0].params.callbacks!.onmessage({serverContent:{turnComplete:true}} as unknown as LiveServerMessage);
  sessions[0].params.callbacks!.onmessage({serverContent:{inputTranscription:{text:'Change once more.'}}} as unknown as LiveServerMessage);
  await until(()=>messages.some(m=>m.type==='caption'&&m.text==='Change once more.'),'third learner request');
  emit('interrupted');await until(()=>messages.filter(m=>m.type==='tool').length===3,'third client visual');
  ws.send(JSON.stringify({type:'interrupt'}));await until(()=>sessions.length===2,'explicit interruption');
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(sessions[0].responses.length,2,'interrupted pending visual result is dropped');
  ws.send(JSON.stringify({type:'end'}));
});

async function controlledVoice(t:any,execute:(input:any)=>Promise<unknown>,options:{diagnostics?:boolean;observeTool?:VoiceDependencies['observeTool'];snapshot?:VoiceDependencies['snapshot'];tools?:VoiceDependencies['tools']}={}){
  const env=process.env as Record<string,string|undefined>,old=env.NODE_ENV;env.NODE_ENV='test';
  t.after(()=>{if(old===undefined)delete env.NODE_ENV;else env.NODE_ENV=old;});
  const app=Fastify();t.after(()=>app.close());let epoch=0;
  const sessions:{params:LiveConnectParameters;responses:any[];input:any[];context:any[]}[]=[],messages:any[]=[];
  await registerVoice(app,dependencies({config:{enabled:true,apiKey:'synthetic-not-a-credential',model:'gemini-3.8-live',origin,ticketSecret:'d'.repeat(64),toolDiagnostics:options.diagnostics},
    currentEpoch:async()=>epoch,interrupt:async()=>++epoch,reserve:async(_u,_l,id)=>({id,seconds:1200}),settle:async()=>{},
    tools:options.tools??[{name:'board.patch',parametersJsonSchema:{type:'object',properties:{stepIndex:{type:'integer'}}}}],
    snapshot:options.snapshot??(async()=>({boardRevision:1})),observeTool:options.observeTool,
    executeTool:execute,providerConnect:async params=>{const s={params,responses:[] as any[],input:[] as any[],context:[] as any[]};sessions.push(s);
      return{close(){},sendClientContent(value:any){s.context.push(value);},sendRealtimeInput(value:any){s.input.push(value);},sendToolResponse(value:any){s.responses.push(value);}} as unknown as Session;},
  }));
  const ticket=(await app.inject({method:'POST',url:'/api/lessons/controlled/live-ticket',headers:{origin}})).json();
  const ws=await app.injectWS(ticket.wsPath,{headers:{origin}},{onInit:socket=>socket.on('message',raw=>messages.push(JSON.parse(raw.toString())))});
  t.after(()=>ws.terminate());await until(()=>messages.some(m=>m.state==='listening'),'controlled provider');
  const emit=(message:any)=>sessions[0].params.callbacks!.onmessage(message as unknown as LiveServerMessage);
  const call=(id:string,args:any={stepIndex:1})=>emit({toolCall:{functionCalls:[{id,name:'board.patch',args}]}});
  const responses=()=>sessions[0].responses.flatMap(x=>x.functionResponses);
  return{emit,call,responses,messages,sessions,ws,currentEpoch:()=>epoch};
}

test('one visual mutation reserves concurrent calls and only actual learner input grants another step',async t=>{
  let executeCount=0,release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const h=await controlledVoice(t,async()=>{executeCount++;if(executeCount===1)await gate;return{status:'saved',revision:executeCount};});
  h.emit({toolCall:{functionCalls:[{id:'first',name:'board.patch',args:{stepIndex:1}},{id:'parallel',name:'board.patch',args:{stepIndex:2}}]}});
  await until(()=>h.responses().some(r=>r.response.error?.code==='visual_busy'),'concurrent reservation denial');
  assert.equal(executeCount,1);release();await until(()=>h.responses().some(r=>r.id==='first'),'first visual succeeds');
  h.emit({serverContent:{turnComplete:true}});
  h.emit({serverContent:{inputTranscription:{text:'Next '}}});h.emit({serverContent:{inputTranscription:{text:'step'}}});
  await until(()=>h.messages.filter(m=>m.type==='caption').length===2,'learner fragments accepted');
  h.call('second');await until(()=>h.responses().some(r=>r.id==='second'),'second learner turn visual');assert.equal(executeCount,2);
  h.emit({serverContent:{inputTranscription:{text:' please'}}});
  h.call('automatic');await until(()=>h.responses().some(r=>r.id==='automatic'),'automatic advance denied');
  const denial=h.responses().find(r=>r.id==='automatic');assert.equal(denial.response.error.code,'learner_turn_limit');assert.equal(denial.response.retryable,false);
  h.emit({serverContent:{turnComplete:true}});h.call('after-tool-complete');
  await until(()=>h.messages.some(m=>m.code==='visual_retry_limit'),'bounded automatic retries stopped');assert.equal(executeCount,2);
  assert.equal(h.sessions.length,1,'normal learner input never reopened the provider');
});

test('typed visual errors permit one correction, redact unexpected failures and stop an invalid loop',async t=>{
  let calls=0,saved=0;
  const h=await controlledVoice(t,async input=>{calls++;
    if(input.args.stepIndex===-1)throw Object.assign(new DomainError('invalid_params','PRIVATE SQL and student content'),{validationDiagnostics:[{path:'/args/stepIndex',keyword:'minimum',actualType:'number'},{path:'/PRIVATE-CONTENT',keyword:'PRIVATE-SECRET',actualType:'PRIVATE-SECRET'}]});
    if(input.args.stepIndex===99)throw Error('PRIVATE SQL password and raw student content');
    saved++;return{status:'saved',revision:saved};
  });
  h.call('invalid',{stepIndex:-1});await until(()=>h.responses().length===1,'typed error feedback');
  assert.equal(h.responses()[0].response.error.code,'invalid_params');assert.equal(h.responses()[0].response.retryable,true);
  assert.deepEqual(h.responses()[0].response.error.validationDiagnostics[0],{path:'/args/stepIndex',keyword:'minimum',actualType:'number'});
  assert.equal(JSON.stringify(h.responses()).includes('PRIVATE'),false);
  h.call('corrected',{stepIndex:0});await until(()=>h.responses().length===2,'corrected request');assert.equal(saved,1);
  h.emit({serverContent:{turnComplete:true}});h.emit({serverContent:{inputTranscription:{text:'Try a different step.'}}});
  await until(()=>h.messages.some(m=>m.type==='caption'),'new learner turn resets failure budget');
  h.call('unexpected',{stepIndex:99});await until(()=>h.responses().length===3,'redacted unexpected error');
  assert.equal(h.responses()[2].response.error.code,'tool_failed');assert.equal(h.responses()[2].response.retryable,false);
  assert.equal(JSON.stringify(h.responses()).includes('PRIVATE'),false);
  h.call('unexpected-again',{stepIndex:99});await until(()=>h.messages.some(m=>m.code==='visual_retry_limit'),'two-attempt cap');
  const count=calls;h.call('third-retry',{stepIndex:99});await new Promise(r=>setTimeout(r,10));assert.equal(calls,count);assert.equal(saved,1);
});

test('new learner speech durably invalidates a pending tool without reconnecting the provider',async t=>{
  let release!:()=>void,started=false,commits=0;
  const gate=new Promise<void>(r=>{release=r;});
  let h:Awaited<ReturnType<typeof controlledVoice>>;
  h=await controlledVoice(t,async input=>{started=true;await gate;if(input.turnEpoch!==h.currentEpoch())throw new DomainError('stale_turn','Old mutation rejected.');commits++;return{status:'saved',revision:1};});
  h.call('old-pending');await until(()=>started,'old tool pending');const oldEpoch=h.currentEpoch();
  h.emit({serverContent:{turnComplete:true}});h.emit({serverContent:{inputTranscription:{text:'Use the tree instead.'}}});
  await until(()=>h.currentEpoch()>oldEpoch,'durable app epoch changed for new input');release();
  await until(()=>h.messages.some(m=>m.type==='caption'),'new learner caption');await new Promise(r=>setTimeout(r,10));
  assert.equal(commits,0);assert.equal(h.responses().length,0);assert.equal(h.sessions.length,1);
  h.ws.send(JSON.stringify({type:'end'}));
});

test('opt-in diagnostic observes rejected cross-dataset fields without raw data, then exact tree recovery paints before narration',async t=>{
  const graph:DsaDataset={kind:'graph',directed:false,nodes:[{id:'PRIVATE_GRAPH_A',label:'PRIVATE_LABEL'}],edges:[]};
  const tree:DsaDataset={kind:'binary_tree',directed:true,rootId:'PRIVATE_ROOT',nodes:[{id:'PRIVATE_ROOT',label:'PRIVATE_TREE_LABEL'},{id:'PRIVATE_LEFT',label:'PRIVATE_CHILD_LABEL'}],edges:[{from:'PRIVATE_ROOT',to:'PRIVATE_LEFT',side:'left'}]};
  const dsaSources=[{sourceId:'PRIVATE_GRAPH_SOURCE',versionId:'PRIVATE_GRAPH_VERSION',name:'PRIVATE_GRAPH_FILENAME',dsa:graph},{sourceId:'PRIVATE_TREE_SOURCE',versionId:'PRIVATE_TREE_VERSION',name:'PRIVATE_TREE_FILENAME',dsa:tree}];
  let board:any={id:'PRIVATE_BOARD',kind:'dsa',sourceId:dsaSources[0].sourceId,revision:1,algorithm:'dfs',result:dsaAnalysis(graph,{algorithm:'dfs'})},paintedRevision=1,commits=0;
  const observations:VoiceToolObservation[]=[];
  const h=await controlledVoice(t,async input=>{
    validateVisualProposal({type:input.name,args:input.args},{question:'Explain the requested structure',goal:'',board,passages:[],attempts:[],notebook:[],dsaSources});
    const selected=input.name==='board.patch'?dsaSources.find(s=>s.sourceId===board.sourceId)!:dsaSources.find(s=>s.sourceId===input.args.sourceId)!;
    const args=input.name==='board.patch'?{algorithm:board.algorithm,...input.args}:input.args;
    board={id:board.id,kind:'dsa',sourceId:selected.sourceId,revision:board.revision+1,...args,result:dsaAnalysis(selected.dsa,args)};paintedRevision=board.revision;commits++;
    return{status:'saved',objectId:board.id,revision:board.revision,board};
  },{diagnostics:true,snapshot:async()=>({board,paintedRevision,dsaSources}),observeTool:event=>{observations.push(event);if(event.outcome==='proposed')throw Error('observer failure cannot affect execution');},
    tools:[{name:'board.replace',parametersJsonSchema:{type:'object'}},{name:'board.patch',parametersJsonSchema:{type:'object'}}]});
  h.emit({toolCall:{functionCalls:[{id:'PRIVATE_PROVIDER_CALL',name:'board.replace',args:{kind:'binary_tree',sourceId:'PRIVATE_TREE_SOURCE',algorithm:'inorder',startNode:'PRIVATE_GRAPH_A',label:'PRIVATE_PROPOSED_LABEL',PRIVATE_UNKNOWN_FIELD:'PRIVATE_VALUE'}}]}});
  await until(()=>h.messages.some(m=>m.type==='tool_error'),'safe client rejection');const rejected=h.messages.find(m=>m.type==='tool_error');
  assert.equal(rejected.code,'invalid_params');assert.equal(rejected.phase,'execution');assert.equal(rejected.retryable,true);assert.equal(rejected.attempt,1);
  assert.equal(rejected.diagnostics.kindCategory,'invalid_dsa_structure_kind');assert.equal(rejected.diagnostics.sourceMatch,'authorized_other');assert.equal(rejected.diagnostics.sourceStructure,'binary_tree');assert.equal(rejected.diagnostics.startNodeMember,false);assert.equal(rejected.diagnostics.startNodeIsRoot,false);assert.equal(rejected.diagnostics.algorithmCompatible,true);assert.equal(rejected.diagnostics.unknownFieldCount,1);
  assert.equal(commits,0);assert.equal(JSON.stringify(rejected).includes('PRIVATE'),false);assert.equal(JSON.stringify(observations).includes('PRIVATE'),false);
  h.emit({toolCall:{functionCalls:[{id:'correct-tree',name:'board.replace',args:{kind:'dsa',sourceId:'PRIVATE_TREE_SOURCE',algorithm:'inorder'}}]}});
  await until(()=>h.responses().some(r=>r.id==='correct-tree'),'corrected tree result');assert.equal(commits,1);assert.equal(board.sourceId,'PRIVATE_TREE_SOURCE');assert.equal(board.result.algorithm,'inorder');assert.equal(board.result.stepIndex,0);
  assert.equal(h.responses().find(r=>r.id==='correct-tree').response.result.display.status,'shown');
  const completed=observations.filter(o=>o.callDigest!==rejected.diagnostics.callDigest);assert.deepEqual(completed.map(o=>[o.phase,o.outcome]),[['admission','proposed'],['execution','saved'],['paint','shown']]);
  h.emit({serverContent:{turnComplete:true}});h.emit({serverContent:{inputTranscription:{text:'Next step'}}});await until(()=>h.messages.some(m=>m.type==='caption'),'new learner step request');
  h.call('tree-next',{stepIndex:1});await until(()=>h.responses().some(r=>r.id==='tree-next'),'tree patch after new input');assert.equal(commits,2);
  const next=[...observations].reverse().find(o=>o.outcome==='proposed')!;assert.equal(next.sourceMatch,'current');assert.equal(next.sourceStructure,'binary_tree');assert.equal(next.algorithm,'inorder');assert.equal(h.sessions.length,1);
});

test('diagnostics are opt-in on the client and classify only known database failure categories',async t=>{
  const observations:VoiceToolObservation[]=[];let code='23503';
  const h=await controlledVoice(t,async()=>{throw Object.assign(Error('PRIVATE SQL table and password'),{code});},{observeTool:event=>{observations.push(event);}});
  const examples=[['23503','foreign_key_constraint'],['23514','check_constraint'],['22P02','invalid_database_value'],['PRIVATE_UNKNOWN_SQLSTATE','unexpected'],['toString','unexpected']];
  for(let index=0;index<examples.length;index++){
    if(index){h.emit({serverContent:{turnComplete:true}});h.emit({serverContent:{inputTranscription:{text:'Try the requested diagram again'}}});await until(()=>h.messages.filter(m=>m.type==='caption').length===index,'new real learner boundary');}
    code=examples[index][0];h.call(`failure-${index}`);await until(()=>observations.filter(o=>o.outcome==='rejected').length===index+1,'safe failure category');
    const rejected=observations.filter(o=>o.outcome==='rejected').at(-1)!;assert.equal(rejected.failureCategory,examples[index][1]);assert.equal(rejected.code,'tool_failed');assert.equal(rejected.phase,'execution');
  }
  assert.equal(h.messages.some(m=>m.type==='tool_error'),false);assert.equal(JSON.stringify(observations).includes('PRIVATE'),false);assert.equal(JSON.stringify(h.responses()).includes('PRIVATE'),false);
});

test('concurrent visual budget denial is diagnosed as admission, not a gateway execution failure',async t=>{
  let release!:()=>void,calls=0;const gate=new Promise<void>(resolve=>{release=resolve;}),observations:VoiceToolObservation[]=[];
  const h=await controlledVoice(t,async()=>{calls++;await gate;return{status:'saved',revision:1};},{diagnostics:true,observeTool:event=>{observations.push(event);}});
  h.emit({toolCall:{functionCalls:[{id:'first-in-flight',name:'board.patch',args:{stepIndex:1}},{id:'parallel-denied',name:'board.patch',args:{stepIndex:2}}]}});
  await until(()=>h.messages.some(m=>m.type==='tool_error'),'admission diagnostic');const rejected=observations.find(o=>o.outcome==='rejected')!;
  assert.equal(rejected.phase,'admission');assert.equal(rejected.code,'visual_busy');assert.equal(rejected.visualInFlight,true);assert.equal(rejected.visualCommitted,false);assert.equal(calls,1);
  release();await until(()=>h.responses().some(r=>r.id==='first-in-flight'),'original visual completes');assert.equal(calls,1);
});

test('fresh provider connections may reuse call IDs: graph/tree/BST save distinct gateway actions and old cancellation cannot poison a new connection',async t=>{
  const state=emptyState(),courseId='synthetic-course',lessonId='controlled';state.courses.push({id:courseId,name:'Synthetic switching regression'});
  state.lessons.push({id:lessonId,courseId,goal:'Graph then tree then BST',epoch:0,messages:[],receipts:{},attempts:[],quiet:false});
  const datasets:DsaDataset[]=[
    {kind:'graph',directed:false,nodes:[{id:'A',label:'A'},{id:'B',label:'B'}],edges:[{from:'A',to:'B'}]},
    {kind:'binary_tree',directed:true,rootId:'root',nodes:[{id:'root',label:'root'},{id:'left',label:'left'}],edges:[{from:'root',to:'left',side:'left'}]},
    {kind:'bst',directed:true,rootId:'n8',nodes:[{id:'n8',label:'8',value:8},{id:'n4',label:'4',value:4}],edges:[{from:'n8',to:'n4',side:'left'}]},
  ];
  state.sources=datasets.map((dsa,index):Source=>({id:`synthetic-source-${index}`,versionId:`synthetic-version-${index}`,courseId,name:`mock-${index}.json`,revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'synthetic-private',passages:[],skippedPages:[],dsa}));
  const actionIds:string[]=[],observations:VoiceToolObservation[]=[];let h:Awaited<ReturnType<typeof controlledVoice>>;
  h=await controlledVoice(t,async input=>{
    assert.equal(input.turnEpoch,h.currentEpoch());state.lessons[0].epoch=input.turnEpoch;
    const board=state.lessons[0].board;actionIds.push(input.actionId);
    return perform(state,{actionId:input.actionId,sessionId:lessonId,turnEpoch:input.turnEpoch,type:input.name,targetId:board?.id??'synthetic-board',expectedRevision:board?.revision??0,args:input.args},'model');
  },{diagnostics:true,observeTool:event=>{observations.push(event);},snapshot:async()=>({board:state.lessons[0].board,paintedRevision:state.lessons[0].board?.revision,dsaSources:state.sources.map(s=>({sourceId:s.id,versionId:s.versionId,name:s.name,dsa:s.dsa}))}),
    tools:[{name:'board.create',parametersJsonSchema:{type:'object'}},{name:'board.replace',parametersJsonSchema:{type:'object'}}]});
  const rawId='provider-call-id-reused-between-connections';
  const emit=(session:number,message:any)=>h.sessions[session].params.callbacks!.onmessage(message as LiveServerMessage);
  const call=(session:number,name:string,args:any)=>emit(session,{toolCall:{functionCalls:[{id:rawId,name,args}]}});
  const graphArgs={kind:'dsa',sourceId:state.sources[0].id,algorithm:'bfs'};
  call(0,'board.create',graphArgs);await until(()=>h.sessions[0].responses.length===1,'first graph gateway receipt');
  assert.equal(state.lessons[0].board?.sourceId,state.sources[0].id);assert.equal(h.sessions[0].responses[0].functionResponses[0].id,rawId);
  call(0,'board.create',{algorithm:'bfs',sourceId:state.sources[0].id,kind:'dsa'});await until(()=>h.sessions[0].responses.length===2,'same-generation duplicate receipt replay');assert.equal(actionIds.length,1);assert.equal(h.sessions[0].responses[1].functionResponses[0].response.result.display.status,'shown');
  call(0,'board.create',{...graphArgs,algorithm:'dfs'});await until(()=>h.sessions[0].responses.length===3,'same-ID changed payload denial');assert.equal(h.sessions[0].responses[2].functionResponses[0].response.error.code,'payload_conflict');assert.equal(actionIds.length,1);
  emit(0,{toolCallCancellation:{ids:[rawId]}});h.ws.send(JSON.stringify({type:'text',text:'Show the binary tree inorder.'}));await until(()=>h.sessions.length===2,'fresh tree connection');
  call(1,'board.replace',{kind:'dsa',sourceId:state.sources[1].id,algorithm:'inorder'});await until(()=>h.sessions[1].responses.length===1,'same raw ID saves exact tree');
  assert.equal(state.lessons[0].board?.sourceId,state.sources[1].id);assert.equal(state.lessons[0].board?.result.algorithm,'inorder');assert.equal(state.lessons[0].board?.result.stepIndex,0);
  emit(1,{toolCallCancellation:{ids:[rawId]}});h.ws.send(JSON.stringify({type:'text',text:'Search the BST for four.'}));await until(()=>h.sessions.length===3,'fresh BST connection');
  // A late old-provider cancellation is discarded by its captured generation.
  emit(0,{toolCallCancellation:{ids:[rawId]}});emit(1,{toolCallCancellation:{ids:[rawId]}});
  call(2,'board.replace',{kind:'dsa',sourceId:state.sources[2].id,algorithm:'search',targetValue:4});await until(()=>h.sessions[2].responses.length===1,'same raw ID saves exact BST');
  assert.equal(state.lessons[0].board?.sourceId,state.sources[2].id);assert.equal(state.lessons[0].board?.result.algorithm,'search');assert.equal(state.lessons[0].board?.result.targetValue,4);assert.equal(state.lessons[0].board?.history.length,2);
  assert.equal(actionIds.length,3);assert.equal(new Set(actionIds).size,3);assert.ok(actionIds.every(id=>id.length<=128));assert.equal(Object.keys(state.lessons[0].receipts).length,3);
  for(const session of h.sessions)assert.equal(session.responses[0].functionResponses[0].id,rawId,'wire FunctionResponse keeps the original provider ID');
  assert.equal(new Set(observations.filter(o=>o.outcome==='saved').map(o=>o.callDigest)).size,3);assert.equal(h.messages.some(m=>m.code==='visual_retry_limit'),false);
});

test('old pending call cleanup cannot erase a fresh connection call with the same raw ID',async t=>{
  let releaseOld!:()=>void,releaseNew!:()=>void,started=0,commits=0;
  const oldGate=new Promise<void>(r=>{releaseOld=r;}),newGate=new Promise<void>(r=>{releaseNew=r;});t.after(()=>{releaseOld();releaseNew();});
  let h:Awaited<ReturnType<typeof controlledVoice>>;h=await controlledVoice(t,async input=>{
    const position=++started;await(position===1?oldGate:newGate);if(input.turnEpoch!==h.currentEpoch())throw new DomainError('stale_turn','Superseded tool.');commits++;return{status:'saved',revision:1};
  });
  h.call('same-pending-id');await until(()=>started===1,'old provider tool pending');
  h.ws.send(JSON.stringify({type:'text',text:'Use the next dataset.'}));await until(()=>h.sessions.length===2,'fresh provider connection');
  const freshEmit=(message:any)=>h.sessions[1].params.callbacks!.onmessage(message as LiveServerMessage);
  freshEmit({toolCall:{functionCalls:[{id:'same-pending-id',name:'board.patch',args:{stepIndex:1}}]}});await until(()=>started===2,'fresh same-ID call is independently admitted');
  releaseOld();await new Promise(r=>setTimeout(r,15));const before=h.currentEpoch();
  freshEmit({serverContent:{turnComplete:true}});freshEmit({serverContent:{inputTranscription:{text:'Stop that change and use the tree.'}}});
  await until(()=>h.currentEpoch()>before,'fresh pending identity survives old finally and invalidates durably on actual new input');
  releaseNew();await new Promise(r=>setTimeout(r,15));assert.equal(commits,0);assert.equal(h.sessions.length,2);assert.equal(h.responses().length,0);assert.equal(h.sessions[1].responses.length,0);
});

test('generic Next step after reconnect carries current board and request atomically, without a separate context turn or altered learner grounding',async t=>{
  const graph:DsaDataset={kind:'graph',directed:false,nodes:[{id:'A',label:'A'},{id:'B',label:'B'}],edges:[{from:'A',to:'B'}]};
  const analysis=dsaAnalysis(graph,{algorithm:'bfs',stepIndex:0});
  const snapshot={epoch:0,board:{id:'owned-board',kind:'dsa',sourceId:'owned-graph',sourceVersionId:'owned-version',revision:1,algorithm:'bfs',stepIndex:0,result:{algorithm:'bfs',stepIndex:0,currentStep:analysis.steps[0],nextStepIndex:1,stepCount:analysis.steps.length,frontierKind:'queue'}},paintedRevision:1,dsaSources:[{sourceId:'owned-graph',versionId:'owned-version',name:'Mock graph',dsa:graph}]};
  const received:any[]=[];
  const h=await controlledVoice(t,async input=>{received.push(input);assert.equal(input.inputText,'Next step');return{status:'saved',revision:2};},{snapshot:async()=>snapshot});
  assert.equal(h.sessions[0].context[0].turnComplete,true,'initial startup may produce its one opening reply');
  h.ws.send(JSON.stringify({type:'text',text:'Next step'}));await until(()=>h.sessions.length===2&&h.sessions[1].input.length===1,'atomic generic follow-up');
  const fresh=h.sessions[1];assert.equal(fresh.context.length,0,'fresh question never depends on a separate unordered clientContent context');assert.equal(fresh.input.length,1);
  assert.deepEqual(Object.keys(fresh.input[0]),['text']);const wire=String(fresh.input[0].text),payload=JSON.parse(wire.slice(wire.indexOf('\n')+1));
  assert.equal(payload.learnerRequest,'Next step');assert.deepEqual(payload.confirmedLesson,snapshot);assert.equal(payload.confirmedLesson.board.algorithm,'bfs');assert.equal(payload.confirmedLesson.board.result.stepIndex,0);assert.equal(payload.confirmedLesson.board.result.nextStepIndex,1);assert.equal(payload.confirmedLesson.board.result.nextStep,undefined);
  assert.deepEqual(payload.requestedNavigation,{type:'board.patch',args:{stepIndex:1}});
  fresh.params.callbacks!.onmessage({toolCall:{functionCalls:[{id:'next-step',name:'board.patch',args:{stepIndex:1}}]}} as unknown as LiveServerMessage);
  await until(()=>fresh.responses.length===1,'generic next step executes on the fresh connection');assert.equal(received.length,1);assert.equal(received[0].inputText,'Next step');assert.equal(fresh.context.length,0);assert.equal(fresh.input.length,1);
});

test('generic next on the current BST cannot replace it with the original BFS goal, while a later spoken source switch remains available',async t=>{
  const state=emptyState(),courseId='navigation-course',lessonId='controlled',goal='Explain BFS on the original graph starting at step zero.';
  state.courses.push({id:courseId,name:'Synthetic navigation'});state.lessons.push({id:lessonId,courseId,goal,epoch:0,messages:[],receipts:{},attempts:[],quiet:false});
  const graph:DsaDataset={kind:'graph',directed:false,nodes:[{id:'A',label:'A'}],edges:[]},bst:DsaDataset={kind:'bst',directed:true,rootId:'n8',nodes:[{id:'n8',label:'8',value:8},{id:'n4',label:'4',value:4}],edges:[{from:'n8',to:'n4',side:'left'}]};
  state.sources=[graph,bst].map((dsa,index):Source=>({id:`navigation-source-${index}`,versionId:`navigation-version-${index}`,courseId,name:`mock-${index}.json`,revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'synthetic-private',passages:[],skippedPages:[],dsa}));
  perform(state,{actionId:'seed-current-bst',sessionId:lessonId,turnEpoch:0,type:'board.create',targetId:'navigation-board',expectedRevision:0,args:{kind:'dsa',sourceId:state.sources[1].id,algorithm:'search',targetValue:7}},'model');
  const observedInputs:any[]=[];let h:Awaited<ReturnType<typeof controlledVoice>>;
  const dsaSources=state.sources.map(s=>({sourceId:s.id,versionId:s.versionId,name:s.name,dsa:s.dsa!}));
  h=await controlledVoice(t,async input=>{
    observedInputs.push(input);state.lessons[0].epoch=input.turnEpoch;const board=state.lessons[0].board!;
    validateVisualProposal({type:input.name,args:input.args},{question:input.inputText??'',goal,board,passages:[],attempts:[],notebook:[],dsaSources});
    return perform(state,{actionId:input.actionId,sessionId:lessonId,turnEpoch:input.turnEpoch,type:input.name,targetId:board.id,expectedRevision:board.revision,args:input.args},'model');
  },{diagnostics:true,snapshot:async()=>{const board=state.lessons[0].board!,{steps,...computed}=board.result;return{goal,board:{...board,result:{...computed,currentStep:steps[board.result.stepIndex],stepCount:steps.length,nextStepIndex:board.result.stepIndex+1}},paintedRevision:board.revision,dsaSources};},
    tools:['board.create','board.replace','board.patch','board.undo','source.open','course.search'].map(name=>({name,parametersJsonSchema:{type:'object'}}))});
  const request='Next step only. Say one short sentence about the current step.';h.ws.send(JSON.stringify({type:'text',text:request}));await until(()=>h.sessions.length===2&&h.sessions[1].input.length===1,'current BST navigation request');
  const fresh=h.sessions[1],wire=String(fresh.input[0].text),payload=JSON.parse(wire.slice(wire.indexOf('\n')+1));
  assert.equal(payload.learnerRequest,request);assert.deepEqual(payload.requestedNavigation,{type:'board.patch',args:{stepIndex:1}});assert.equal(payload.confirmedLesson.goal,undefined);assert.equal(wire.includes(goal),false);
  assert.equal(payload.confirmedLesson.board.sourceId,state.sources[1].id);assert.equal(payload.confirmedLesson.board.result.algorithm,'search');assert.equal(payload.confirmedLesson.board.result.targetValue,7);
  const names=fresh.params.config!.tools!.flatMap(tool=>'functionDeclarations'in tool?tool.functionDeclarations?.map(d=>d.name)??[]:[]);assert.ok(names.includes('board.replace'),'later spoken source switches must remain in the session registry');
  const emit=(message:any)=>fresh.params.callbacks!.onmessage(message as LiveServerMessage);
  emit({toolCall:{functionCalls:[{id:'wrong-old-goal',name:'board.replace',args:{kind:'dsa',sourceId:state.sources[0].id,algorithm:'bfs',stepIndex:0}}]}});await until(()=>fresh.responses.length===1,'old goal reset rejected before gateway');
  assert.equal(observedInputs.length,0);assert.equal(fresh.responses[0].functionResponses[0].response.error.code,'invalid_params');assert.deepEqual(fresh.responses[0].functionResponses[0].response.expectedNavigation,{type:'board.patch',args:{stepIndex:1}});
  emit({toolCall:{functionCalls:[{id:'correct-bst-next',name:'board.patch',args:{stepIndex:1}}]}});await until(()=>fresh.responses.length===2,'correct BST comparison shown');
  assert.equal(observedInputs.length,1);assert.equal(observedInputs[0].inputText,request);assert.equal(state.lessons[0].board!.sourceId,state.sources[1].id);assert.equal(state.lessons[0].board!.result.algorithm,'search');assert.equal(state.lessons[0].board!.result.targetValue,7);assert.equal(state.lessons[0].board!.result.stepIndex,1);
  emit({serverContent:{turnComplete:true}});emit({serverContent:{inputTranscription:{text:'Show BFS on the graph instead.'}}});await until(()=>h.messages.some(m=>m.type==='caption'),'new spoken source request');
  emit({toolCall:{functionCalls:[{id:'spoken-switch',name:'board.replace',args:{kind:'dsa',sourceId:state.sources[0].id,algorithm:'bfs'}}]}});await until(()=>fresh.responses.length===3,'spoken source switch remains usable on same connection');
  assert.equal(state.lessons[0].board!.sourceId,state.sources[0].id);assert.equal(state.lessons[0].board!.result.algorithm,'bfs');assert.equal(h.sessions.length,2);assert.equal(h.messages.some(m=>m.code==='visual_retry_limit'),false);
});

async function visualOperationVoice(t:any,existing:boolean){
  const state=emptyState(),courseId='operation-course',lessonId='controlled';state.courses.push({id:courseId,name:'Synthetic operation test'});state.lessons.push({id:lessonId,courseId,goal:'Discuss the current visual',epoch:0,messages:[],receipts:{},attempts:[],quiet:false});
  const graph:DsaDataset={kind:'graph',directed:false,nodes:[{id:'A',label:'A'}],edges:[]},tree:DsaDataset={kind:'binary_tree',directed:true,rootId:'n1',nodes:[{id:'n1',label:'1'},{id:'n2',label:'2'}],edges:[{from:'n1',to:'n2',side:'left'}]};
  state.sources=[graph,tree].map((dsa,index):Source=>({id:`operation-source-${index}`,versionId:`operation-version-${index}`,courseId,name:`mock-${index}.json`,revision:1,hash:'a'.repeat(64),status:'ready',storageKey:'synthetic-private',passages:[],skippedPages:[],dsa}));
  if(existing)perform(state,{actionId:'seed-dfs',sessionId:lessonId,turnEpoch:0,type:'board.create',targetId:'operation-board',expectedRevision:0,args:{kind:'dsa',sourceId:state.sources[0].id,algorithm:'dfs'}},'model');
  const operations:string[]=[],registry=['board.create','board.replace','board.patch','board.undo','source.open','course.search'].map(name=>({name,parametersJsonSchema:{type:'object'}}));
  const dsaSources=state.sources.map(s=>({sourceId:s.id,versionId:s.versionId,name:s.name,dsa:s.dsa!}));
  const h=await controlledVoice(t,async input=>{operations.push(input.name);state.lessons[0].epoch=input.turnEpoch;const board=state.lessons[0].board;
    validateVisualProposal({type:input.name,args:input.args},{question:input.inputText??'',goal:'',board,passages:[],attempts:[],notebook:[],dsaSources});
    return perform(state,{actionId:input.actionId,sessionId:lessonId,turnEpoch:input.turnEpoch,type:input.name,targetId:board?.id??'operation-board',expectedRevision:board?.revision??0,args:input.args},'model');
  },{diagnostics:true,snapshot:async()=>({board:state.lessons[0].board,paintedRevision:state.lessons[0].board?.revision,dsaSources}),tools:registry});
  const emit=(message:any)=>h.sessions[0].params.callbacks!.onmessage(message as LiveServerMessage);
  const call=(id:string,name:string,args:any)=>emit({toolCall:{functionCalls:[{id,name,args}]}});
  const names=h.sessions[0].params.config!.tools!.flatMap(tool=>'functionDeclarations'in tool?tool.functionDeclarations?.map(d=>d.name)??[]:[]);
  return{h,state,operations,registry,emit,call,names};
}

test('an existing DFS board omits only create; a spoken inorder request replaces it on the same provider connection',async t=>{
  const {h,state,operations,registry,emit,call,names}=await visualOperationVoice(t,true);
  assert.equal(names.includes('board.create'),false);for(const name of['board.replace','board.patch','board.undo','source.open','course.search'])assert.ok(names.includes(name));assert.ok(registry.some(tool=>tool.name==='board.create'),'registry input is not mutated');
  const boardId=state.lessons[0].board!.id;
  emit({serverContent:{inputTranscription:{text:'Show the binary tree using inorder traversal.'}}});await until(()=>h.messages.some(m=>m.type==='caption'),'spoken tree request');
  call('spoken-inorder','board.replace',{kind:'dsa',sourceId:state.sources[1].id,algorithm:'inorder',stepIndex:0});await until(()=>h.responses().length===1,'exact replacement render receipt');
  const board=state.lessons[0].board!;assert.deepEqual(operations,['board.replace']);assert.equal(board.id,boardId);assert.equal(board.sourceId,state.sources[1].id);assert.equal(board.sourceVersionId,state.sources[1].versionId);assert.equal(board.result.algorithm,'inorder');assert.equal(board.result.stepIndex,0);assert.equal(board.history.length,1);assert.equal(board.history[0].result.algorithm,'dfs');assert.equal(h.sessions.length,1);assert.equal(h.responses()[0].response.result.display.status,'shown');
});

test('empty startup can create once; later create-on-existing stays rejected with replacement guidance and the two-failure stop',async t=>{
  const {h,state,operations,emit,call,names}=await visualOperationVoice(t,false);assert.ok(names.includes('board.create'));
  call('first-create','board.create',{kind:'dsa',sourceId:state.sources[0].id,algorithm:'dfs'});await until(()=>h.responses().length===1,'first empty-board creation');assert.deepEqual(operations,['board.create']);assert.match(h.responses()[0].response.result.operationGuidance,/board\.replace/);
  emit({serverContent:{turnComplete:true}});emit({serverContent:{inputTranscription:{text:'Now show the binary tree inorder.'}}});await until(()=>h.messages.some(m=>m.type==='caption'),'new source request');
  const treeArgs={kind:'dsa',sourceId:state.sources[1].id,algorithm:'inorder'};
  call('wrong-create','board.create',treeArgs);await until(()=>h.responses().length===2,'wrong create receives a safe correction');
  const failure=h.responses()[1].response;assert.equal(failure.error.code,'target_changed');assert.equal(failure.error.expectedOperation,'board.replace');assert.equal(failure.retryable,true);assert.match(failure.error.message,/board\.patch/);assert.match(failure.error.message,/board\.replace/);assert.deepEqual(operations,['board.create'],'create was not aliased into an edit');assert.equal(state.lessons[0].board!.sourceId,state.sources[0].id);
  call('correct-replace','board.replace',treeArgs);await until(()=>h.responses().length===3,'model correction uses explicit replace');assert.deepEqual(operations,['board.create','board.replace']);assert.equal(state.lessons[0].board!.sourceId,state.sources[1].id);assert.equal(h.sessions.length,1);
  emit({serverContent:{turnComplete:true}});emit({serverContent:{inputTranscription:{text:'Show the graph again.'}}});await until(()=>h.messages.filter(m=>m.type==='caption').length===2,'another actual request');
  call('repeat-wrong-create-1','board.create',{kind:'dsa',sourceId:state.sources[0].id,algorithm:'bfs'});await until(()=>h.responses().length===4,'first incorrect attempt');
  call('repeat-wrong-create-2','board.create',{kind:'dsa',sourceId:state.sources[0].id,algorithm:'bfs'});await until(()=>h.messages.some(m=>m.code==='visual_retry_limit'),'second incorrect attempt stops safely');
  assert.deepEqual(operations,['board.create','board.replace']);assert.equal(state.lessons[0].board!.sourceId,state.sources[1].id);
});

const origin = 'http://localhost:3000';
function dependencies(overrides: Partial<VoiceDependencies> = {}): VoiceDependencies {
  return {
    config: { enabled: false, model: 'gemini-3.8-live', origin, ticketSecret: 'a'.repeat(64) },
    authorize: async () => ({ userId: 'synthetic-test-user' }),
    snapshot: async () => ({ boardRevision: 1 }), currentEpoch: async () => 1,
    interrupt: async () => 2, executeTool: async () => { throw new Error('must not execute'); },
    reserve: async () => { throw new Error('quota_exhausted'); }, settle: async () => undefined,
    ...overrides,
  };
}

test('voice without configured provider fails visibly, never returning fabricated audio', async t => {
  const app = Fastify(); t.after(() => app.close());
  await registerVoice(app, dependencies());
  const response = await app.inject({ method: 'POST', url: '/api/lessons/lesson-test/live-ticket', headers: { origin } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'provider_unavailable');
  assert.equal(response.json().ticket, undefined);
});

test('wrong origin cannot mint a voice ticket', async t => {
  const app = Fastify(); t.after(() => app.close());
  let authorized = false;
  await registerVoice(app, dependencies({ authorize: async () => { authorized = true; return { userId: 'test' }; } }));
  const response = await app.inject({ method: 'POST', url: '/api/lessons/lesson-test/live-ticket', headers: { origin: 'https://untrusted.example' } });
  assert.equal(response.statusCode, 403);
  assert.equal(authorized, false);
});

test('single-use signed ticket cannot be replayed and no quota means no provider connection', async t => {
  const app = Fastify(); t.after(() => app.close());
  let reservations = 0;
  await registerVoice(app, dependencies({
    config: { enabled: true, apiKey: 'unit-test-never-used', model: 'gemini-3.8-live', origin, ticketSecret: 'b'.repeat(64) },
    reserve: async () => { reservations++; throw new Error('quota_exhausted'); },
  }));
  const response = await app.inject({ method: 'POST', url: '/api/lessons/lesson-test/live-ticket', headers: { origin } });
  assert.equal(response.statusCode, 200);
  const ticket = response.json();
  assert.equal(typeof ticket.ticket, 'string');
  assert.equal(ticket.expiresAt > Date.now(), true);
  const errors: string[] = [];
  async function connect() {
    let finish!: (code: number) => void;
    const closed = new Promise<number>(resolve => { finish = resolve; });
    const ws = await app.injectWS(ticket.wsPath, { headers: { origin } }, { onInit: ws => {
      ws.on('close', code => finish(code));
      ws.on('message', raw => {const message=JSON.parse(raw.toString());if(message.type==='error')errors.push(message.code);});
    } });
    t.after(() => ws.terminate());
    return Promise.race([closed, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('close timeout')), 2000); timer.unref(); })]);
  }
  assert.equal(await connect(), 1000);
  assert.equal(await connect(), 1008);
  assert.equal(reservations, 1);
  assert.deepEqual(errors,['quota_exhausted']);
});

test('oversized voice context fails before provider work and settles a known zero-cost admission',async t=>{
  const env=process.env as Record<string,string|undefined>,previous=env.NODE_ENV;env.NODE_ENV='test';
  t.after(()=>{if(previous===undefined)delete env.NODE_ENV;else env.NODE_ENV=previous;});
  const critical={board:{id:'synthetic-board',revision:4},sources:[{id:'synthetic-source',versionId:'synthetic-version'}]};
  assert.deepEqual(JSON.parse(encodeVoiceContext(critical)),critical);
  assert.throws(()=>encodeVoiceContext({data:'x'.repeat(24000)}),(error:any)=>error.code==='voice_context_too_large');
  const app=Fastify();t.after(()=>app.close());let epoch=0,providerCalls=0;
  const settlements:any[]=[],messages:any[]=[];
  await registerVoice(app,dependencies({
    config:{enabled:true,apiKey:'synthetic-not-a-credential',model:'gemini-3.8-live',origin,ticketSecret:'c'.repeat(64)},
    snapshot:async()=>({data:'x'.repeat(24000)}),currentEpoch:async()=>epoch,interrupt:async()=>++epoch,
    reserve:async(_u,_l,id)=>({id,seconds:1200}),settle:async(_id,seconds,usage,options)=>{settlements.push({seconds,usage,options});},
    providerConnect:async()=>{providerCalls++;throw Error('must not connect');},
  }));
  const ticket=(await app.inject({method:'POST',url:'/api/lessons/synthetic-lesson/live-ticket',headers:{origin}})).json();
  const ws=await app.injectWS(ticket.wsPath,{headers:{origin}},{onInit:socket=>socket.on('message',raw=>messages.push(JSON.parse(raw.toString())))});
  t.after(()=>ws.terminate());await until(()=>settlements.length===1,'zero-cost admission settlement');
  assert.equal(providerCalls,0);assert.equal(messages.some(m=>m.code==='voice_context_too_large'),true);
  assert.deepEqual(settlements,[{seconds:0,usage:[],options:{noProviderWork:true}}]);
});

for (const retainLiveTranscript of [false, true]) test(`synthetic reconnect drops late actions, settles once, transcript opt-in=${retainLiveTranscript}, stale read rejects=${retainLiveTranscript}`, async t => {
  const testEnv = process.env as Record<string, string | undefined>;
  const previous = testEnv.NODE_ENV;
  testEnv.NODE_ENV = 'test';
  t.after(() => { if (previous === undefined) delete testEnv.NODE_ENV; else testEnv.NODE_ENV = previous; });
  const app = Fastify(); t.after(() => app.close());
  let epoch = 0, bins = 4, commits = 0, settlements = 0, paintedRevision = 0, budgetRows = 0;
  let paired = false;
  let releaseLate!: () => void;
  const late = new Promise<void>(resolve => { releaseLate = resolve; });
  let lateStarted = false;
  let blockEpochRead = false, epochReadStarted = false;
  let releaseEpochRead!: () => void;
  const epochReadGate = new Promise<void>((resolve,reject) => {releaseEpochRead=()=>retainLiveTranscript?reject(Error('synthetic old-generation read failed')):resolve();});
  const sessions: { params: LiveConnectParameters; closed: boolean; responses: unknown[]; input: unknown[]; context: unknown[] }[] = [];
  const receipts = new Map<string, unknown>();
  const emit = (index: number, data: Record<string, unknown>) => sessions[index].params.callbacks!.onmessage(data as unknown as LiveServerMessage);
  const observed: Record<string, any>[] = [];
  let settledUsage: unknown[] = [];
  const retainedTurns: any[] = [];
  await registerVoice(app, dependencies({
    config: { enabled: true, apiKey: 'unit-test-never-used', model: 'gemini-3.8-live', origin, ticketSecret: 'c'.repeat(64), retainLiveTranscript },
    currentEpoch: async () => {
      if(blockEpochRead){blockEpochRead=false;epochReadStarted=true;await epochReadGate;}
      return epoch;
    }, interrupt: async () => ++epoch,
    snapshot: async () => ({ board: { id: 'histogram', revision: commits + 1 }, paintedRevision }),
    reserve: async (_u, _l, id) => ({ id, seconds: 1200 }),
    settle: async (_id, _seconds, usage) => { settlements++; settledUsage = usage; },
    authorizeFrame: async () => false,
    recordMetric: event => { observed.push(event); },
    recordTurn: async (_u, _l, turn) => { retainedTurns.push(turn); },
    toolsForSession: async () => [
      { name: 'board.patch', parametersJsonSchema: { type: 'object', properties: { binCount: { type: 'integer' } } } },
      ...(paired ? [{ name: 'notebook.propose', parametersJsonSchema: { type: 'object', properties: { replacement: { type: 'string' } } } }] : []),
    ],
    usageAllowed: async (_id, rows) => { budgetRows += rows.length; return false; },
    providerConnect: async params => {
      const record = { params, closed: false, responses: [] as unknown[], input: [] as unknown[], context: [] as unknown[] };
      sessions.push(record);
      return {
        close() { record.closed = true; },
        sendClientContent(content: unknown) { record.context.push(content); },
        sendRealtimeInput(input: unknown) { record.input.push(input); },
        sendToolResponse(response: unknown) { record.responses.push(response); },
      } as unknown as Session;
    },
    executeTool: async input => {
      if(input.args.binCount===5)assert.equal(input.inputText,'Please use five bins.');
      if (receipts.has(input.actionId)) return receipts.get(input.actionId);
      if (input.args.binCount === 10) { lateStarted = true; await late; }
      if (input.turnEpoch !== epoch) return { status: 'stale_turn' };
      bins = Number(input.args.binCount); commits++;
      const result = { bins, revision: commits + 1 };
      receipts.set(input.actionId, result); return result;
    },
  }));
  const ticket = (await app.inject({ method: 'POST', url: '/api/lessons/lesson-test/live-ticket', headers: { origin } })).json();
  const messages: any[] = [];
  const ws = await app.injectWS(ticket.wsPath, { headers: { origin } }, { onInit: ws => ws.on('message', raw => messages.push(JSON.parse(raw.toString()))) });
  t.after(() => ws.terminate());
  await until(() => sessions.length === 1 && messages.some(m => m.state === 'listening'), 'initial listening');
  assert.equal((sessions[0].context[0] as any).turnComplete,true,'initial start may give one opening reply');
  emit(0, { serverContent: { outputTranscription: { text: 'Unplayed old turn' } } });
  assert.equal(JSON.stringify(sessions[0].params.config?.tools).includes('notebook.propose'), false);
  emit(0, { toolCall: { functionCalls: [{ id: 'ten', name: 'board.patch', args: { binCount: 10 } }] } });
  await until(() => lateStarted, 'late tool started');
  // A database read may finish after the user interrupts. Its old audio must
  // never inherit the new global epoch and slip through the client's filter.
  blockEpochRead=true;
  emit(0,{serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(480).toString('base64')}}]}}});
  await until(()=>epochReadStarted,'old audio waiting on epoch read');
  paired = true; ws.send(JSON.stringify({ type: 'interrupt' }));
  await until(() => sessions.length === 2, 'reconnected provider');
  assert.equal(JSON.stringify(sessions[1].params.config?.tools).includes('notebook.propose'), true);
  assert.equal(JSON.stringify(sessions[1].params.config?.tools).includes('notebook.apply'), false);
  assert.equal((sessions[1].context[0] as any).turnComplete,false,'interruption restores context without starting a spoken recap');
  assert.match(JSON.stringify(sessions[1].context[0]),/Wait for the learner/);
  releaseEpochRead();
  releaseLate();
  emit(1, { serverContent: { inputTranscription: { text: 'Please use five bins.' } } });
  emit(1, { toolCall: { functionCalls: [{ id: 'five', name: 'board.patch', args: { binCount: 5 } }] } });
  await until(() => bins === 5, 'five bin commit');
  const renderContexts = () => sessions[1].context.filter(context => JSON.stringify(context).includes('App render receipt:'));
  ws.send(JSON.stringify({ type: 'metric', name: 'board_render_proxy', revision: 2 }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(renderContexts().length, 0, 'WS assertion cannot invent an authenticated paint receipt');
  paintedRevision = 2;
  ws.send(JSON.stringify({ type: 'metric', name: 'board_render_proxy', revision: 2 }));
  await until(() => renderContexts().length === 1, 'confirmed paint context');
  assert.match(JSON.stringify(renderContexts()[0]), /browser_ack_proxy/);
  assert.equal((renderContexts()[0] as any).turnComplete,false,'paint receipts must not trigger a new turn');
  emit(1, { serverContent: { inputTranscription: { text: 'Five ' }, outputTranscription: { text: 'Generated ' } } });
  emit(1, { serverContent: { inputTranscription: { text: 'bins' }, outputTranscription: { text: 'reply' }, turnComplete: true } });
  emit(1, { serverContent: { turnComplete: true } });
  await until(() => messages.filter(message => message.state === 'listening').length >= 4, 'completed turn captions');
  assert.equal(retainedTurns.length, retainLiveTranscript ? 1 : 0);
  assert.equal(sessions.length,2,'ordinary completed turns do not reconnect the provider');
  assert.equal(messages.some(message=>message.type==='audio'),false,'old audio waiting across an interrupt was discarded');
  if (retainLiveTranscript) {
    assert.equal(retainedTurns[0].inputText, 'Please use five bins.Five bins');
    assert.equal(retainedTurns[0].outputText, 'Generated reply');
    assert.equal(retainedTurns[0].played, 'unknown');
    assert.equal(JSON.stringify(retainedTurns).includes('Unplayed old turn'), false);
  }
  // Replayed delivery returns its original receipt rather than another mutation.
  emit(1, { toolCall: { functionCalls: [{ id: 'five', name: 'board.patch', args: { binCount: 5 } }] } });
  ws.send(JSON.stringify({ type: 'frame', captureId: 'revoked', frameId: 'old', mimeType: 'image/jpeg', data: 'AAAA' }));
  await until(() => messages.some(m => m.code === 'revoked_frame'), 'frame denial');
  emit(1, { usageMetadata: { promptTokenCount: 123, responseTokenCount: 45, totalTokenCount: 168, promptTokensDetails: [{ modality: MediaModality.AUDIO, tokenCount: 100 }] } });
  await until(() => settlements === 1, 'settlement');
  assert.equal(budgetRows, 1);
  assert.equal(messages.some(message => message.code === 'quota_exhausted'), true);
  assert.equal(commits, 1);
  assert.equal(bins, 5);
  assert.equal(sessions.every(s => s.closed), true);
  assert.equal(sessions[0].responses.length, 0);
  assert.equal(settledUsage.length, 1);
  assert.equal((settledUsage[0] as any).promptTokenCount, 123);
  assert.equal(observed.every(event => event.fixture === true), true);
  assert.equal(messages.every(message => message.fixture === true), true);
  assert.equal(sessions.some(s => s.input.some((input: any) => input.video)), false);
});
