import {vectorAnalysis} from './vectors.ts';
import {dsaAnalysis,type DsaAlgorithm,type DsaDataset} from './dsa.ts';
export type VisualKind='vectors'|'histogram'|'regression'|'probability'|'dsa';
export interface VisualSource{id:string;name:string;status?:string;dataset?:{numericColumns:string[];rows:Record<string,string>[]};dsa?:DsaDataset}
export function readyVisualDatasets(sources:VisualSource[]){return sources.filter(source=>source.dataset&&source.dataset.numericColumns.length>0&&(!source.status||source.status.startsWith('ready')));}
export function readyDsaSources(sources:VisualSource[]){return sources.filter(source=>source.dsa&&(!source.status||source.status.startsWith('ready')));}
export function visualCreation(input:{kind:VisualKind;sourceId?:string;xColumn?:string;yColumn?:string;vectorA?:unknown;vectorB?:unknown;algorithm?:DsaAlgorithm;startNode?:string;targetValue?:number},sources:VisualSource[]):{ready:boolean;message?:string;args?:Record<string,unknown>}{
  if(input.kind==='dsa'){
    const ready=readyDsaSources(sources),selected=input.sourceId?ready.find(source=>source.id===input.sourceId):ready[0];
    if(!selected?.dsa)return{ready:false,message:'Upload a structured graph or tree JSON file, then choose it here.'};
    try{
      const result=dsaAnalysis(selected.dsa,{algorithm:input.algorithm??'bfs',startNode:input.startNode||selected.dsa.rootId||selected.dsa.nodes[0]?.id,targetValue:input.targetValue,stepIndex:0,showFrontier:true});
      return{ready:true,args:{kind:'dsa',sourceId:selected.id,algorithm:result.algorithm,startNode:input.startNode||selected.dsa.rootId||selected.dsa.nodes[0].id,stepIndex:0,showFrontier:true,...(result.algorithm==='search'?{targetValue:result.targetValue}:{})}};
    }catch(error){return{ready:false,message:error instanceof Error?error.message:'Choose a valid traversal for this graph or tree.'};}
  }
  if(input.kind==='vectors'){
    try{const computed=vectorAnalysis(input.vectorA,input.vectorB);return{ready:true,args:{kind:'vectors',vectorA:computed.vectorA,vectorB:computed.vectorB,showProjection:true,showAngle:true}};}
    catch(error){return{ready:false,message:error instanceof Error?error.message:'Enter two numeric coordinates for each vector.'};}
  }
  if(input.kind==='probability'&&(!input.sourceId||input.sourceId==='reviewed'))return{ready:true,args:{kind:'probability',cells:[3,9,6,2],conditioning:'row0'}};
  const datasets=readyVisualDatasets(sources),selected=input.sourceId?datasets.find(source=>source.id===input.sourceId):datasets[0];
  if(!selected?.dataset)return{ready:false,message:'Upload a ready CSV with numeric data, then choose it here.'};
  const columns=selected.dataset.numericColumns,x=input.xColumn||columns[0],y=input.yColumn||columns.find(column=>column!==x);
  if(!columns.includes(x))return{ready:false,message:'Choose a numeric column from the selected dataset.'};
  const number=(row:Record<string,string>,column:string)=>row[column]?.trim()?Number(row[column]):NaN;
  if(input.kind==='histogram'){
    if(!selected.dataset.rows.some(row=>Number.isFinite(number(row,x))))return{ready:false,message:'The selected column has no finite observations.'};
    return{ready:true,args:{kind:'histogram',sourceId:selected.id,column:x,binCount:4,mode:'count'}};
  }
  if(!y||x===y||!columns.includes(y))return{ready:false,message:'Choose two different numeric columns from this dataset.'};
  if(input.kind==='probability'){
    if(selected.dataset.rows.length!==2)return{ready:false,message:'A conditional probability table needs exactly two data rows.'};
    if(selected.dataset.rows.some(row=>[number(row,x),number(row,y)].some(value=>!Number.isFinite(value)||value<0)))return{ready:false,message:'Both count columns need finite nonnegative values in each row.'};
    return{ready:true,args:{kind:'probability',sourceId:selected.id,xColumn:x,yColumn:y,conditioning:'row0'}};
  }
  let pairs=0;for(const row of selected.dataset.rows){if(Number.isFinite(number(row,x))&&Number.isFinite(number(row,y)))pairs++;if(pairs>=2)break;}
  if(pairs<2)return{ready:false,message:'A scatterplot needs at least two rows with both numeric values.'};
  return{ready:true,args:{kind:'regression',sourceId:selected.id,xColumn:x,yColumn:y}};
}
