import {DomainError} from '../contracts/index.ts';
export type DsaAlgorithm='bfs'|'dfs'|'inorder'|'preorder'|'postorder'|'search';
export type DsaNode={id:string;label:string;value?:number};
export type DsaEdge={from:string;to:string;side?:'left'|'right'};
export type DsaDataset={kind:'graph'|'binary_tree'|'bst';directed:boolean;rootId?:string;nodes:DsaNode[];edges:DsaEdge[]};
export type DsaStep={currentId:string|null;frontierIds:string[];visitedIds:string[];action:string;explanation:string};
export type DsaOptions={algorithm?:DsaAlgorithm;startNode?:string;stepIndex?:number;showFrontier?:boolean;targetValue?:number};
export interface DsaAnalysis {
 kind:DsaDataset['kind'];directed:boolean;rootId?:string;nodes:(DsaNode&{x:number;y:number})[];edges:DsaEdge[];
 steps:DsaStep[];order:string[];stepIndex:number;algorithm:DsaAlgorithm;showFrontier:boolean;
 foundId:string|null;targetValue?:number;bounds:{width:number;height:number};origin:string;
 frontierKind:'queue'|'stack'|'recursion-stack'|'search-path';reachableCount:number;totalNodes:number;
}
const invalid=(message:string):never=>{throw new DomainError('invalid_params',message,400);};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(value);
/** Source values remain data; only bounded declarative graph structure is accepted. */
export function validateDsaDataset(value:unknown):DsaDataset{
 const data=value as DsaDataset;
 if(!data||typeof data!=='object'||Object.keys(data).some(key=>!['kind','directed','rootId','nodes','edges'].includes(key))||!['graph','binary_tree','bst'].includes(data.kind)||typeof data.directed!=='boolean'||!Array.isArray(data.nodes)||!Array.isArray(data.edges)||data.nodes.length<1||data.nodes.length>31||data.edges.length>62)invalid('Use a graph, binary tree or BST with 1–31 nodes and at most 62 edges.');
 const ids=new Set<string>();
 for(const node of data.nodes){
  if(!node||Object.keys(node).some(key=>!['id','label','value'].includes(key))||!id(node.id)||ids.has(node.id)||typeof node.label!=='string'||node.label.length<1||node.label.length>60||node.value!==undefined&&(typeof node.value!=='number'||!Number.isFinite(node.value)||Math.abs(node.value)>1e6))invalid('Nodes need unique letter-first identifiers, labels of at most 60 characters and finite numeric values.');
  ids.add(node.id);
 }
 if(data.rootId!==undefined&&(!id(data.rootId)||!ids.has(data.rootId)))invalid('The root must identify an existing node.');
 const edges=new Set<string>();
 for(const edge of data.edges){
  if(!edge||Object.keys(edge).some(key=>!['from','to','side'].includes(key))||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||edge.side!==undefined&&(!['left','right'].includes(edge.side)||data.kind==='graph'))invalid('Every edge must connect different existing nodes; only tree edges use left/right child slots.');
  const key=data.directed?JSON.stringify([edge.from,edge.to]):JSON.stringify([edge.from,edge.to].sort());
  if(edges.has(key))invalid('Duplicate edges are not supported.');edges.add(key);
 }
 if(data.kind!=='graph'){
  if(!data.directed||!data.rootId||data.edges.length!==data.nodes.length-1)invalid('A binary tree needs a directed root and exactly one fewer edge than nodes.');
  const parents=new Map<string,string>(),children=new Map<string,Set<string>>();
  for(const edge of data.edges){
   const sides=children.get(edge.from)??new Set<string>();
   if(!edge.side||sides.has(edge.side)||parents.has(edge.to)||edge.to===data.rootId)invalid('Tree nodes need one parent and distinct left/right child slots.');
   sides.add(edge.side!);children.set(edge.from,sides);parents.set(edge.to,edge.from);
  }
  const seen=new Set<string>();
  const visit=(nodeId:string,lo:number,hi:number)=>{
   if(seen.has(nodeId))invalid('Tree cycles are not supported.');seen.add(nodeId);
   const node=data.nodes.find(n=>n.id===nodeId)!;
   if(data.kind==='bst'&&(node.value===undefined||!(node.value>lo&&node.value<hi)))invalid('BST values must be unique and obey all ancestor left/right bounds.');
   for(const edge of data.edges.filter(e=>e.from===nodeId))visit(edge.to,data.kind==='bst'&&edge.side==='right'?node.value!:lo,data.kind==='bst'&&edge.side==='left'?node.value!:hi);
  };
  visit(data.rootId!,-Infinity,Infinity);if(seen.size!==data.nodes.length)invalid('Every tree node must be reachable from its root.');
 }
 return structuredClone(data);
}
/** BFS/DFS neighbors follow source nodes-array order, independent of edge order.
 * Trees use explicit left/right slots. Coordinates are trusted layout values,
 * not model-authored markup or executable code. */
export function dsaAnalysis(value:unknown,options:DsaOptions={}):DsaAnalysis{
 const data=validateDsaDataset(value),algorithm=options.algorithm??'bfs';
 if(!['bfs','dfs','inorder','preorder','postorder','search'].includes(algorithm))invalid('Choose a supported traversal.');
 if(options.showFrontier!==undefined&&typeof options.showFrontier!=='boolean')invalid('Frontier visibility must be a boolean.');
 const start=options.startNode??data.rootId??data.nodes[0].id;
 if(!data.nodes.some(node=>node.id===start))invalid('Choose an existing starting node.');
 if(['inorder','preorder','postorder','search'].includes(algorithm)&&data.kind==='graph')invalid('This operation requires a binary tree or BST.');
 if(algorithm==='search'&&(data.kind!=='bst'||typeof options.targetValue!=='number'||!Number.isFinite(options.targetValue)||Math.abs(options.targetValue)>1e6))invalid('BST search requires a valid BST and finite target value.');
 if(['inorder','preorder','postorder','search'].includes(algorithm)&&options.startNode!==undefined&&start!==data.rootId)invalid('Tree traversal and BST search begin at the dataset root.');
 const order:string[]=[],steps:DsaStep[]=[];
 const record=(currentId:string|null,frontierIds:string[],action:string,explanation:string)=>steps.push({currentId,frontierIds:[...frontierIds],visitedIds:[...order],action,explanation});
 const child=(node:string,side:'left'|'right')=>data.edges.find(e=>e.from===node&&e.side===side)?.to;
 const neighbors=(node:string)=>data.kind==='graph'?data.nodes.filter(n=>data.edges.some(e=>e.from===node&&e.to===n.id||!data.directed&&e.to===node&&e.from===n.id)).map(n=>n.id):[child(node,'left'),child(node,'right')].filter((n):n is string=>n!==undefined);
 const frontierKind=algorithm==='bfs'?'queue':algorithm==='dfs'?'stack':algorithm==='search'?'search-path':'recursion-stack';
 const readyFrontier=['bfs','dfs','search'].includes(algorithm)?[start]:[];
 record(null,readyFrontier,'ready',`Ready to run ${algorithm}. No node has been visited${algorithm==='search'?' or compared':''}.${readyFrontier.length?` The next candidate is ${data.nodes.find(n=>n.id===start)!.label}.`:''} Neighbor ties use the dataset node order; tree traversals use left/right child slots.`);
 if(algorithm==='bfs'||algorithm==='dfs'){
  const frontier=[start],scheduled=new Set([start]),visited=new Set<string>();
  while(frontier.length){
   const current=algorithm==='bfs'?frontier.shift()!:frontier.pop()!;
   if(visited.has(current)){
    record(current,[...frontier].reverse(),'skip_visited',`Pop ${data.nodes.find(n=>n.id===current)!.label} again and skip it: this node was already visited. This DFS marks visited on pop, so the stack may contain repeated entries.`);continue;
   }
   visited.add(current);order.push(current);
   const next=neighbors(current).filter(n=>algorithm==='bfs'?!scheduled.has(n):!visited.has(n));for(const n of next)scheduled.add(n);
   frontier.push(...(algorithm==='dfs'?[...next].reverse():next));
   const visible=algorithm==='dfs'?[...frontier].reverse():frontier;
   record(current,visible,'visit',`Visit ${data.nodes.find(n=>n.id===current)!.label}; ${algorithm==='bfs'?'dequeue oldest, then enqueue unseen neighbors':'mark visited on pop, then push unvisited neighbors in reverse order; repeated stack entries are shown and skipped when popped'}.`);
  }
 }else if(algorithm==='search'){
  let current:string|undefined=start;
  while(current){const node=data.nodes.find(n=>n.id===current)!;order.push(current);const found=node.value===options.targetValue;const side=options.targetValue!<node.value!?'left':'right';const next:string|undefined=found?undefined:child(current,side);
   record(current,next?[next]:[],found?'found':next?'compare':'not_found',found?`Found target ${options.targetValue} at ${node.label}.`:`${options.targetValue} ${side==='left'?'<':'>'} ${node.value}; ${next?`follow the ${side} child`:`the ${side} child is absent, so the target is not in this BST`}.`);current=next;
  }
 }else{
  const walk=(current:string,ancestors:string[])=>{const left=child(current,'left'),right=child(current,'right'),stack=[...ancestors,current];
   const visit=()=>{order.push(current);record(current,ancestors,'visit',`Visit ${data.nodes.find(n=>n.id===current)!.label} in ${algorithm} order. Frontier shows active recursion ancestors.`);};
   if(algorithm==='preorder')visit();if(left)walk(left,stack);if(algorithm==='inorder')visit();if(right)walk(right,stack);if(algorithm==='postorder')visit();
  };walk(data.rootId!,[]);
 }
 const requested=options.stepIndex??0;
 if(!Number.isInteger(requested)||requested<0||requested>=steps.length)invalid(`Choose a traversal step between 0 and ${steps.length-1}.`);
 const positions=new Map<string,{x:number;y:number}>();let width=1000,height=600;
 if(data.kind==='graph')data.nodes.forEach((node,i)=>{const angle=-Math.PI/2+i*2*Math.PI/data.nodes.length;positions.set(node.id,{x:data.nodes.length===1?500:500+370*Math.cos(angle),y:data.nodes.length===1?300:300+220*Math.sin(angle)});});
 else{
  let rank=0,maxDepth=0;const visit=(node:string,depth:number)=>{maxDepth=Math.max(maxDepth,depth);const left=child(node,'left'),right=child(node,'right');if(left)visit(left,depth+1);positions.set(node,{x:++rank,y:depth});if(right)visit(right,depth+1);};visit(data.rootId!,0);
  // Inorder rank gives every node a unique x. Reserve at least 96 SVG units
  // between ranks AND levels: even the largest inspection outline (84 units)
  // cannot overlap another node/outline. Expand bounds rather than compress
  // accepted skew trees into the initial viewport; the renderer can scroll/zoom.
  width=Math.max(1000,160+data.nodes.length*96);height=Math.max(600,140+maxDepth*96);
  for(const position of positions.values()){position.x=80+(position.x-.5)*(width-160)/data.nodes.length;position.y=maxDepth?70+position.y*(height-140)/maxDepth:height/2;}
 }
 return{kind:data.kind,directed:data.directed,rootId:data.rootId,nodes:data.nodes.map(node=>({...node,...positions.get(node.id)!})),edges:data.edges,steps,order,stepIndex:requested,algorithm,showFrontier:options.showFrontier!==false,foundId:steps[requested].action==='found'?steps[requested].currentId:null,targetValue:algorithm==='search'?options.targetValue:undefined,bounds:{width,height},origin:'Uploaded structured dataset',frontierKind,reachableCount:order.length,totalNodes:data.nodes.length};
}
