import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundedTutorInput,
  explicitVectorPairs,
  reply,
  validateVisualProposal,
  type TutorInput,
} from "./index.ts";
import { vectorAnalysis } from "../board/index.ts";
import { GoogleGenAI, FinishReason } from "@google/genai";
import {dsaAnalysis,type DsaDataset} from '../board/dsa.ts';
import {perform} from '../../apps/api/src/gateway.ts';
import {emptyState} from '../../apps/api/src/store.ts';
import type {Action} from '../contracts/index.ts';
import {readFileSync} from 'node:fs';

const input = (overrides: Partial<TutorInput> = {}): TutorInput => ({
  question: "Explain the dot product and projection of a=[2,2] onto b=[-1,3].",
  goal: "Understand the coursework",
  passages: [],
  board: null,
  attempts: [],
  notebook: [],
  ...overrides,
});
const usage = {
  promptTokenCount: 120,
  candidatesTokenCount: 45,
  totalTokenCount: 165,
};
const graph:DsaDataset={kind:'graph',directed:false,rootId:'A',nodes:[{id:'A',label:'A'},{id:'B',label:'B'},{id:'C',label:'C'}],edges:[{from:'A',to:'B'},{from:'A',to:'C'}]};
const dsaSource={sourceId:'owned-graph',versionId:'version-1',name:'graph.json',dsa:graph};

test('DSA fixture creates the owned graph before explanation and narrates only the computed selected step',async()=>{
  const propose=await reply(input({question:'Explain BFS on graph.json.',dsaSources:[dsaSource]}),{fixture:true,paid:false,model:'fixture'});
  assert.equal(propose.text,'');assert.equal(propose.visualProposal?.type,'board.create');
  assert.deepEqual(propose.visualProposal?.args,{kind:'dsa',sourceId:'owned-graph',algorithm:'bfs',stepIndex:0,showFrontier:true});
  const result=dsaAnalysis(graph,{algorithm:'bfs',stepIndex:1});
  const board={id:'graph-board',kind:'dsa',sourceId:'owned-graph',revision:2,algorithm:'bfs',stepIndex:1,result};
  const explained=await reply(input({question:'Explain this step.',phase:'grounded',dsaSources:[dsaSource],board,paintedRevision:2,
    passages:[{passageId:'other-source',sourceId:'another-source',text:'Unrelated'},{passageId:'owned-nodes',sourceId:'owned-graph',text:'Nodes A, B, C and edges A–B, A–C.'}]}),{fixture:true,paid:false,model:'fixture'});
  assert.match(explained.text,/displayed step 1/);assert.match(explained.text,/queue: \[B, C\]/);assert.match(explained.text,/Visited: \[A\]/);
  assert.equal(explained.visualProposal,undefined);
  assert.deepEqual(explained.citationIds,['owned-nodes']);
  const next=await reply(input({question:'Next step please.',dsaSources:[dsaSource],board}),{fixture:true,paid:false,model:'fixture'});
  assert.deepEqual(next.visualProposal,{type:'board.patch',args:{stepIndex:2}});
});

test('DSA fact questions need no unrelated visual, missing data is never invented, and changing topic preserves prior board through replace',async()=>{
  const config={fixture:true,paid:false,model:'fixture'};
  const fact=await reply(input({question:'What does BFS stand for?',dsaSources:[dsaSource]}),config);
  assert.equal(fact.visualProposal,undefined);assert.match(fact.text,/breadth-first search/);
  const missing=await reply(input({question:'Show DFS for my assignment.'}),config);
  assert.equal(missing.visualProposal,undefined);assert.match(missing.text,/structured graph/);
  const switched=await reply(input({question:'Explain DFS using graph.json.',dsaSources:[dsaSource],board:{kind:'vectors',vectorA:[2,2],vectorB:[-1,3]}}),config);
  assert.equal(switched.visualProposal?.type,'board.replace');assert.equal(switched.visualProposal?.args.sourceId,'owned-graph');
  assert.equal(switched.visualProposal?.args.algorithm,'dfs');
  const typo=await reply(input({question:'Explain DSF on my graph.',dsaSources:[dsaSource]}),config);
  assert.equal(typo.visualProposal?.args.algorithm,'dfs');
});

test('DSA proposals require owned structured sources, actual node IDs and valid algorithm/step bounds',()=>{
  const current=input({question:'Explain BFS.',dsaSources:[dsaSource]});
  for(const args of [
    {kind:'dsa',sourceId:'invented',algorithm:'bfs'},
    {kind:'dsa',sourceId:'owned-graph',algorithm:'bfs',startNode:'invented'},
    {kind:'dsa',sourceId:'owned-graph',algorithm:'inorder'},
    {kind:'dsa',sourceId:'owned-graph',algorithm:'bfs',stepIndex:40},
  ])assert.throws(()=>validateVisualProposal({type:'board.create',args},current));
});

test('DSA packing preserves complete graphs and the provider schema restricts source IDs and permits reversible replacement',async()=>{
  const packed=boundedTutorInput(input({question:'Explain graph.json.',dsaSources:Array.from({length:5},(_,i)=>({...dsaSource,sourceId:`source-${i}`}))}));
  assert.equal(packed.dsaSources?.length,4);assert.deepEqual(packed.dsaSources?.[0].dsa,graph);
  const stub=transport({text:'',citationIds:[],visualProposal:{type:'board.create',args:{kind:'dsa',sourceId:'owned-graph',algorithm:'bfs'}}});
  await reply(input({question:'Explain BFS.',dsaSources:[dsaSource]}),paid(stub.client));
  const options=stub.calls[2].parameters.config.responseSchema.properties.visualProposal.properties.args.anyOf;
  const schema=options.find((x:any)=>x.properties.kind.enum[0]==='dsa');
  assert.deepEqual(schema.properties.sourceId.enum,['owned-graph']);assert.equal(schema.properties.nodes,undefined);
});

test('DSA model context keeps the exact current step and only the next index without future traversal facts',()=>{
  const result=dsaAnalysis(graph,{algorithm:'dfs',stepIndex:1});
  const packed=boundedTutorInput(input({board:{id:'board',kind:'dsa',revision:4,sourceId:'owned-graph',stepIndex:1,history:[{privatePast:'omitted'}],result}}));
  assert.deepEqual(packed.board.result.currentStep,result.steps[1]);
  assert.equal(packed.board.result.nextStep,undefined);assert.equal(packed.board.result.nextStepIndex,2);assert.equal(packed.board.result.order,undefined);
  assert.equal(packed.board.result.stepCount,result.steps.length);
  assert.deepEqual(packed.board.result.nodes,result.nodes);assert.deepEqual(packed.board.result.edges,result.edges);
  assert.equal(packed.board.result.steps,undefined);assert.equal(packed.board.history,undefined);
});
test('ready BST packing states no comparison has occurred and excludes future comparison explanations',()=>{
  const bst:DsaDataset=JSON.parse(readFileSync(new URL('../../fixtures/dsa/04-binary-search-tree.json',import.meta.url),'utf8')).structure;
  const result=dsaAnalysis(bst,{algorithm:'search',targetValue:7});result.steps[1].explanation='FUTURE_COMPARISON_SECRET';
  const packed=boundedTutorInput(input({question:'Search for 7.',board:{id:'board',kind:'dsa',revision:1,sourceId:'bst-source',algorithm:'search',targetValue:7,stepIndex:0,result}}));
  assert.equal(packed.board.result.currentStep.currentId,null);assert.match(packed.board.result.currentStep.explanation,/No node has been visited or compared/);assert.equal(packed.board.result.nextStepIndex,1);assert.equal(packed.board.result.nextStep,undefined);assert.equal(packed.board.result.order,undefined);assert.equal(packed.board.result.reachableCount,undefined);assert.equal(JSON.stringify(packed).includes('FUTURE_COMPARISON_SECRET'),false);
});

test('DSA fixture chooses the requested tree and keeps that dataset on a next-step request',async()=>{
  const tree:DsaDataset={kind:'bst',directed:true,rootId:'root',nodes:[{id:'root',label:'4',value:4},{id:'left',label:'2',value:2},{id:'right',label:'6',value:6}],edges:[{from:'root',to:'left',side:'left'},{from:'root',to:'right',side:'right'}]};
  const treeSource={sourceId:'owned-tree',name:'tree.json',dsa:tree};
  const config={fixture:true,paid:false,model:'fixture'};
  const switched=await reply(input({question:'Explain inorder traversal of tree.json.',dsaSources:[dsaSource,treeSource],board:{kind:'dsa',sourceId:'owned-graph'}}),config);
  assert.equal(switched.visualProposal?.type,'board.replace');assert.equal(switched.visualProposal?.args.sourceId,'owned-tree');assert.equal(switched.visualProposal?.args.algorithm,'inorder');
  const board={kind:'dsa',sourceId:'owned-tree',stepIndex:0,result:dsaAnalysis(tree,{algorithm:'inorder'})};
  const next=await reply(input({question:'Next step.',dsaSources:[dsaSource,treeSource],board}),config);
  assert.deepEqual(next.visualProposal,{type:'board.patch',args:{stepIndex:1}});
});

function patchAlignmentState(initialArgs:Record<string,unknown>,tree:DsaDataset={kind:'bst',directed:true,rootId:'root',nodes:[{id:'root',label:'4',value:4},{id:'left',label:'2',value:2},{id:'right',label:'6',value:6}],edges:[{from:'root',to:'left',side:'left'},{from:'root',to:'right',side:'right'}]}){
  const state=emptyState();state.courses=[{id:'course',name:'Synthetic validation alignment'}];state.lessons=[{id:'lesson',courseId:'course',goal:'Tree traversal',epoch:0,quiet:false,messages:[],receipts:{},attempts:[]}];
  state.sources=[{id:'owned-tree',courseId:'course',versionId:'tree-v1',name:'tree.json',hash:'synthetic',revision:1,status:'ready',storageKey:'private-synthetic',passages:[],skippedPages:[],dsa:tree}];
  const action=(type:Action['type'],args:Record<string,unknown>):Action=>({actionId:crypto.randomUUID(),sessionId:'lesson',turnEpoch:0,type,targetId:'board',expectedRevision:state.lessons[0].board?.revision??0,args});
  perform(state,action('board.create',{kind:'dsa',sourceId:'owned-tree',...initialArgs}));
  const context=()=>input({question:'Change the selected traversal.',board:state.lessons[0].board,dsaSources:[{sourceId:'owned-tree',name:'tree.json',dsa:tree}]});
  return{state,action,context};
}

test('DSA validator and gateway both clear an inherited non-root BFS start for root-based traversals',()=>{
  for(const [algorithm,order] of [
    ['inorder',['left','root','right']],['preorder',['root','left','right']],['postorder',['left','right','root']],['search',['root','right']],
  ] as const){
    const {state,action,context}=patchAlignmentState({algorithm:'bfs',startNode:'left',stepIndex:1});
    const args={algorithm,...(algorithm==='search'?{targetValue:6}:{})};
    assert.doesNotThrow(()=>validateVisualProposal({type:'board.patch',args},context()));
    const committed=perform(state,action('board.patch',args));
    assert.equal(committed.board.startNode,undefined);assert.equal(committed.board.result.stepIndex,0);assert.deepEqual(committed.board.result.order,order);
  }
});

test('DSA validator and gateway reset a changed BST target to ready instead of applying the prior longer path step',()=>{
  const {state,action,context}=patchAlignmentState({algorithm:'search',targetValue:6,stepIndex:2});
  assert.deepEqual(state.lessons[0].board!.result.order,['root','right']);
  const args={targetValue:4};assert.doesNotThrow(()=>validateVisualProposal({type:'board.patch',args},context()));
  const committed=perform(state,action('board.patch',args));assert.equal(committed.board.targetValue,4);assert.equal(committed.board.result.stepIndex,0);assert.deepEqual(committed.board.result.order,['root']);assert.equal(committed.board.result.steps[1].action,'found');
});

test('DSA reset alignment preserves explicit invalid start-node and explicit step-bound denials at both boundaries',()=>{
  for(const args of [
    {algorithm:'inorder',startNode:'left'},
    {algorithm:'inorder',startNode:'unknown'},
    {targetValue:4,stepIndex:2},
    {algorithm:'inorder',stepIndex:99},
  ]){
    const {state,action,context}=patchAlignmentState({algorithm:'search',targetValue:6,stepIndex:2}),before=structuredClone(state.lessons[0].board);
    assert.throws(()=>validateVisualProposal({type:'board.patch',args},context()));
    assert.throws(()=>perform(state,action('board.patch',args)));assert.deepEqual(state.lessons[0].board,before);
  }
});
test('generic Next on the current BST search overrides an old BFS goal and rejects visual resets or silent operand changes',async()=>{
  const bst:DsaDataset=JSON.parse(readFileSync(new URL('../../fixtures/dsa/04-binary-search-tree.json',import.meta.url),'utf8')).structure;
  const {state,action}=patchAlignmentState({algorithm:'search',targetValue:7,stepIndex:0},bst);
  state.sources.push({id:dsaSource.sourceId,courseId:'course',versionId:'graph-v1',name:dsaSource.name,hash:'synthetic',revision:1,status:'ready',storageKey:'private-graph',passages:[],skippedPages:[],dsa:graph});
  const current=input({question:'Next step only, please. Say one brief sentence about this comparison.',goal:'Explain BFS on the undirected graph starting at A.',board:state.lessons[0].board,dsaSources:[{sourceId:'owned-tree',name:'bst.json',dsa:bst},dsaSource]});
  for(const proposal of [
    {type:'board.replace',args:{kind:'dsa',sourceId:'owned-graph',algorithm:'bfs',startNode:'A',stepIndex:0}},
    {type:'board.patch',args:{stepIndex:1,algorithm:'bfs'}},
    {type:'board.patch',args:{stepIndex:1,targetValue:5}},
    {type:'board.patch',args:{stepIndex:2}},
    {type:'board.patch',args:{stepIndex:1,label:'Silent extra change'}},
  ])assert.throws(()=>validateVisualProposal(proposal as any,current),(error:any)=>error.code==='invalid_params'&&error.validationDiagnostics?.[0].path==='/args/stepIndex'&&!JSON.stringify(error.validationDiagnostics).includes('owned-tree'));
  const fixture=await reply(current,{fixture:true,paid:false,model:'fixture'});assert.deepEqual(fixture.visualProposal,{type:'board.patch',args:{stepIndex:1}});validateVisualProposal(fixture.visualProposal!,current);
  const receipt=perform(state,action('board.patch',fixture.visualProposal!.args),'model');assert.equal(receipt.board.sourceId,'owned-tree');assert.equal(receipt.board.algorithm,'search');assert.equal(receipt.board.targetValue,7);assert.equal(receipt.board.result.stepIndex,1);assert.equal(receipt.board.result.steps[1].currentId,'n8');
  const switched={...current,question:'Switch to BFS on graph.json starting at A.'};assert.doesNotThrow(()=>validateVisualProposal({type:'board.replace',args:{kind:'dsa',sourceId:'owned-graph',algorithm:'bfs',startNode:'A',stepIndex:0}},switched));
  assert.doesNotThrow(()=>validateVisualProposal({type:'board.patch',args:{targetValue:5}},{...current,question:'Search for 5 in the BST.'}));
});
function transport(output: any, totalTokens = 100) {
  const calls: any[] = [];
  const client = {
    models: {
      countTokens: async (parameters: any) => {
        calls.push({ kind: "count", parameters });
        return { totalTokens };
      },
      generateContentStream: async (parameters: any) => {
        calls.push({ kind: "generate", parameters });
        return (async function* () {
          yield { text: JSON.stringify(output), usageMetadata: usage };
        })();
      },
    },
  };
  return { calls, client: client as any };
}
const paid = (client: any) => ({
  fixture: false,
  paid: true,
  apiKey: "synthetic-test-transport-key",
  model: "synthetic-test-model",
  client,
  inputTokenLimit: 16000,
  outputTokenLimit: 1000,
});

test("actual vector operands come from learner/source pairs, including matrix notation and Unicode minus", () => {
  const pairs = explicitVectorPairs(
    input({
      question: String.raw`a=\begin{bmatrix}2\\2\end{bmatrix}, b=(−1,3)`,
    }),
  );
  assert.ok(pairs.some((p) => p[0] === 2 && p[1] === 2));
  assert.ok(pairs.some((p) => p[0] === -1 && p[1] === 3));
  assert.throws(
    () =>
      validateVisualProposal(
        {
          type: "board.create",
          args: { kind: "vectors", vectorA: [8, 7], vectorB: [1, 9] },
        },
        input(),
      ),
    /exact vector coordinates/,
  );
  assert.doesNotThrow(() =>
    validateVisualProposal(
      {
        type: "board.create",
        args: { kind: "vectors", vectorA: [2, 2], vectorB: [-1, 3] },
      },
      input(),
    ),
  );
});
test("missing assignment operands ask for data rather than making up a demonstration", async () => {
  const result = await reply(
    input({ question: "Show the vectors in my assignment" }),
    { fixture: true, paid: false, model: "fixture" },
  );
  assert.match(result.text, /actual 2-D vector/);
  assert.equal(result.visualProposal, undefined);
});
test("fixture proposes exact operands and only explains trusted vector results in grounded phase", async () => {
  const first = await reply(input(), {
    fixture: true,
    paid: false,
    model: "fixture",
  });
  assert.deepEqual(first.visualProposal?.args.vectorA, [2, 2]);
  assert.equal(first.text, "");
  const computed = vectorAnalysis([2, 2], [-1, 3]);
  const second = await reply(
    input({
      phase: "grounded",
      board: {
        kind: "vectors",
        vectorA: [2, 2],
        vectorB: [-1, 3],
        result: computed,
      },
    }),
    { fixture: true, paid: false, model: "fixture" },
  );
  assert.match(second.text, /\*\*4\*\*/);
  assert.match(second.text, /\[-0\.4, 1\.2\]/);
  assert.equal(second.visualProposal, undefined);
  assert.equal(second.patch, undefined);
});
test("a one-vector follow-up changes the named operand instead of replacing the other vector", async () => {
  const board = {
    kind: "vectors",
    vectorA: [2, 2],
    vectorB: [-1, 3],
    result: vectorAnalysis([2, 2], [-1, 3]),
  };
  const result = await reply(
    input({
      question: "Change vector b to [0,4] and show its projection.",
      board,
    }),
    { fixture: true, paid: false, model: "fixture" },
  );
  assert.deepEqual(result.visualProposal?.args.vectorB, [0, 4]);
  assert.equal(result.visualProposal?.args.vectorA, undefined);
  const ambiguous = await reply(
    input({ question: "Change one vector to [0,4].", board }),
    { fixture: true, paid: false, model: "fixture" },
  );
  assert.equal(ambiguous.visualProposal, undefined);
  assert.match(ambiguous.text, /which vector/);
});
test("lesson packing includes eight bounded follow-ups and relevant cells, not an entire large notebook", () => {
  const source = input({
    question: "Explain selected-cell.",
    notebook: [
      {
        sourceId: "notebook-source",
        cells: Array.from({ length: 500 }, (_, i) => ({
          id: i === 400 ? "selected-cell" : `other-${i}`,
          cellType: "markdown",
          source: i === 400 ? "Actual a=[2,2], b=[-1,3]" : ".".repeat(20000),
        })),
      },
    ],
    history: Array.from({ length: 20 }, (_, i) => ({
      role: "student",
      text: `${i}:` + "x".repeat(10000),
    })),
  });
  const bounded = boundedTutorInput(source);
  assert.equal(bounded.history?.length, 8);
  assert.ok(bounded.history!.every((m) => m.text.length <= 700));
  assert.equal(bounded.notebook.length, 5);
  assert.equal(bounded.notebook[0].id, "selected-cell");
  assert.ok(JSON.stringify(bounded).length < 16000);
  assert.ok(
    explicitVectorPairs(bounded).some(
      (pair) => pair[0] === -1 && pair[1] === 3,
    ),
  );
});
test("both provider phases count inputs and restrict output; grounded schema cannot issue another mutation", async () => {
  const first = transport({
    text: "Provisional text must not be used as the final verified result.",
    citationIds: [],
    visualProposal: {
      type: "board.create",
      args: { kind: "vectors", vectorA: [2, 2], vectorB: [-1, 3] },
    },
  });
  const proposal = await reply(input(), paid(first.client));
  assert.ok(proposal.visualProposal);
  assert.deepEqual(
    first.calls.map((c) => c.kind),
    ["count", "count", "generate"],
  );
  const second = transport({
    text: "The computed dot product is 4.",
    citationIds: [],
  });
  await reply(
    input({
      phase: "grounded",
      board: { kind: "vectors", result: vectorAnalysis([2, 2], [-1, 3]) },
    }),
    paid(second.client),
  );
  assert.deepEqual(
    second.calls.map((c) => c.kind),
    ["count", "count", "generate"],
  );
  const config = second.calls[2].parameters.config;
  assert.equal(config.maxOutputTokens, 1000);
  assert.equal(config.responseSchema.properties.visualProposal, undefined);
  assert.equal(config.responseSchema.properties.notebookProposal, undefined);
});
test("count-token ceiling fails before paid generation and reports no provider work", async () => {
  const stub = transport({ text: "Not generated", citationIds: [] }, 16001);
  await assert.rejects(
    reply(input(), paid(stub.client)),
    (error: any) =>
      error.providerStarted === false && /input ceiling/.test(error.message),
  );
  assert.deepEqual(
    stub.calls.map((c) => c.kind),
    ["count"],
  );
});
test("invalid citations or grounded mutation retain real usage for conservative settlement", async () => {
  for (const output of [
    { text: "Unsupported citation", citationIds: ["invented"] },
    { text: "Second mutation", citationIds: [], patch: { binCount: 5 } },
  ]) {
    const stub = transport(output);
    await assert.rejects(
      reply(input({ phase: "grounded" }), paid(stub.client)),
      (error: any) => error.providerStarted === true && error.usage === usage,
    );
  }
});
test("interruption before the call does not generate or pretend to have usage", async () => {
  const controller = new AbortController();
  controller.abort();
  const stub = transport({ text: "No", citationIds: [] });
  await assert.rejects(
    reply(input(), { ...paid(stub.client), signal: controller.signal }),
    (error: any) =>
      error.code === "stale_turn" && error.providerStarted === false,
  );
  assert.equal(stub.calls.length, 0);
});

test("real Developer SDK serializes complete count requests without unsupported config and includes schema headroom", async () => {
  const requests: { url: string; body: any }[] = [];
  const client = new GoogleGenAI({
    vertexai: false,
    enterprise: false,
    apiKey: "synthetic-serialization-only",
    httpOptions: {
      baseUrl: "https://sdk-serialization.invalid",
      fetch: async (url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push({ url: String(url), body });
        if (String(url).includes(":countTokens"))
          return new Response(
            JSON.stringify({
              totalTokens: body.generateContentRequest ? 100 : 200,
            }),
            { headers: { "Content-Type": "application/json" } },
          );
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ text: "A serialized provider reply.", citationIds: [] }) }] }, finishReason: "STOP" }], usageMetadata: usage })}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    },
  });
  // Prove this is the real SDK conversion branch that caught the browser bug.
  await assert.rejects(
    client.models.countTokens({
      model: "synthetic-test-model",
      contents: "data",
      config: { systemInstruction: "unsupported in this backend" },
    }),
    /only supported/,
  );
  assert.equal(requests.length, 0);
  const out = await reply(input(), { ...paid(client), outputTokenLimit: 4096 });
  assert.equal(out.text, "A serialized provider reply.");
  assert.equal(out.finishReason, FinishReason.STOP);
  assert.equal(requests.length, 3);
  const counted = requests[0].body.generateContentRequest,
    generated = requests[2].body;
  assert.equal(counted.model, "models/synthetic-test-model");
  assert.deepEqual(requests[0].body.contents, []);
  assert.deepEqual(counted.systemInstruction, generated.systemInstruction);
  assert.deepEqual(counted.contents, generated.contents);
  assert.deepEqual(counted.generationConfig, generated.generationConfig);
  assert.equal(generated.generationConfig.maxOutputTokens, 4096);
  assert.equal(generated.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.deepEqual(
    counted.generationConfig.responseSchema,
    generated.generationConfig.responseSchema,
  );
  assert.deepEqual(
    JSON.parse(requests[1].body.contents[0].parts[0].text),
    generated.generationConfig.responseSchema,
  );
});

test("visual schema offers only kind-specific create arguments and existing-board patch fields", async () => {
  const create = transport({
    text: "An explanation without a visual.",
    citationIds: [],
  });
  await reply(
    input({
      datasets: [
        {
          sourceId: "dataset",
          name: "scores",
          rowCount: 10,
          columns: ["score"],
          numericColumns: ["score"],
        },
      ],
    }),
    paid(create.client),
  );
  const options =
    create.calls[2].parameters.config.responseSchema.properties.visualProposal
      .properties.args.anyOf;
  assert.equal(options.length, 4);
  for (const option of options)
    assert.ok(Object.keys(option.properties).length <= 12);
  const vectors = options.find(
    (option: any) => option.properties.kind.enum[0] === "vectors",
  );
  assert.deepEqual(vectors.required, ["kind", "vectorA", "vectorB"]);
  assert.equal(vectors.properties.mode, undefined);
  assert.equal(vectors.properties.binCount, undefined);
  const patch = transport({
    text: "An explanation without a visual.",
    citationIds: [],
  });
  await reply(
    input({ board: { kind: "vectors", vectorA: [2, 2], vectorB: [-1, 3] } }),
    paid(patch.client),
  );
  const properties =
    patch.calls[2].parameters.config.responseSchema.properties.visualProposal
      .anyOf[0].properties;
  assert.deepEqual(properties.type.enum, ["board.patch"]);
  assert.deepEqual(Object.keys(properties.args.properties).sort(), [
    "label",
    "showAngle",
    "showProjection",
    "vectorA",
    "vectorB",
  ]);
  assert.deepEqual(patch.calls[2].parameters.config.responseSchema.properties.visualProposal.anyOf[1].properties.type.enum,['board.replace']);
});

test("invalid numeric proposals are rejected with field/type diagnostics and no private values", () => {
  assert.throws(
    () =>
      validateVisualProposal(
        {
          type: "board.create",
          args: {
            kind: "vectors",
            vectorA: [2, null],
            vectorB: [-1, 3],
            label: "PRIVATE-COURSE-CONTEXT",
          },
        },
        input(),
      ),
    (error: any) => {
      assert.equal(error.code, "invalid_params");
      assert.ok(
        error.validationDiagnostics.some(
          (entry: any) =>
            entry.path === "/args/vectorA/1" &&
            entry.keyword === "type" &&
            entry.actualType === "null",
        ),
      );
      const recorded = JSON.stringify(error.validationDiagnostics);
      assert.ok(!recorded.includes("PRIVATE-COURSE-CONTEXT"));
      assert.ok(!recorded.includes("[-1,3]"));
      return true;
    },
  );
});

test("MAX_TOKENS preserves billed usage, records only finish metadata and never publishes partial JSON", async () => {
  const progress: any[] = [];
  const client = {
    models: {
      countTokens: async () => ({ totalTokens: 100 }),
      generateContentStream: async () => {
        return (async function* () {
          yield {
            text: '{"text":"PRIVATE-STUDENT-MATERIAL',
            candidates: [{ finishReason: FinishReason.MAX_TOKENS }],
            usageMetadata: usage,
          };
        })();
      },
    },
  } as any;
  await assert.rejects(
    reply(input(), {
      ...paid(client),
      outputTokenLimit: 4096,
      onProgress: (event) => progress.push(event),
    }),
    (error: any) => {
      assert.equal(error.code, "provider_response_limit");
      assert.equal(error.finishReason, FinishReason.MAX_TOKENS);
      assert.equal(error.providerStarted, true);
      assert.equal(error.usage, usage);
      assert.match(error.message, /one step/);
      assert.ok(!error.message.includes("PRIVATE-STUDENT-MATERIAL"));
      return true;
    },
  );
  assert.ok(
    progress.some(
      (event) =>
        event.stage === "provider_finished" &&
        event.finishReason === FinishReason.MAX_TOKENS,
    ),
  );
  assert.ok(!JSON.stringify(progress).includes("PRIVATE-STUDENT-MATERIAL"));
});

test("schema count plus application framing reserve can deny admission before generation", async () => {
  let countCalls = 0,
    generations = 0;
  const client = {
    models: {
      countTokens: async () => ({
        totalTokens: ++countCalls === 1 ? 100 : 15800,
      }),
      generateContentStream: async () => {
        generations++;
        throw Error("must not generate");
      },
    },
  } as any;
  await assert.rejects(
    reply(input(), paid(client)),
    (error: any) =>
      error.providerStarted === false && /input ceiling/.test(error.message),
  );
  assert.equal(countCalls, 2);
  assert.equal(generations, 0);
});

test("invalid preflight counters never admit a paid generation", async () => {
  for (const invalid of [0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const stub = transport({ text: "not generated", citationIds: [] }, invalid);
    await assert.rejects(
      reply(input(), paid(stub.client)),
      (error: any) => error.providerStarted === false,
    );
    assert.deepEqual(
      stub.calls.map((call) => call.kind),
      ["count"],
    );
  }
});
