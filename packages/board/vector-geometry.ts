import type {Vector2,VectorAnalysis} from './vectors.ts';
import {MAX_VECTOR_COMPONENT,MIN_VECTOR_COMPONENT} from './vectors.ts';
export const VECTOR_VIEW={width:560,height:420,cx:280,cy:210,radius:166} as const;
function niceStep(value:number){const power=10**Math.floor(Math.log10(value));const fraction=value/power;return(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;}
export function vectorViewport(result:VectorAnalysis){
  const values=[...result.vectorA,...result.vectorB,...(result.projection??[0,0])];
  const maximum=Math.max(...values.map(Math.abs));
  const tickStep=niceStep((maximum||1)*2/8),extent=tickStep*Math.ceil((maximum||1)*1.28/tickStep);
  const count=Math.floor(extent/tickStep+1e-9);
  return{extent,tickStep,ticks:Array.from({length:2*count+1},(_,i)=>Number(((i-count)*tickStep).toPrecision(12)))};
}
export function vectorToSvg(vector:Vector2,extent:number):Vector2{
  return[VECTOR_VIEW.cx+vector[0]/extent*VECTOR_VIEW.radius,VECTOR_VIEW.cy-vector[1]/extent*VECTOR_VIEW.radius];
}
export function svgToVector(x:number,y:number,extent:number,tickStep:number):Vector2{
  const step=tickStep/10;
  const round=(value:number)=>{const bound=Math.min(extent,MAX_VECTOR_COMPONENT),clipped=Math.max(-bound,Math.min(bound,value));const n=Number((Math.round(clipped/step)*step).toPrecision(12));return Object.is(n,-0)||Math.abs(n)<MIN_VECTOR_COMPONENT?0:Math.max(-MAX_VECTOR_COMPONENT,Math.min(MAX_VECTOR_COMPONENT,n));};
  return[round((x-VECTOR_VIEW.cx)/VECTOR_VIEW.radius*extent),round((VECTOR_VIEW.cy-y)/VECTOR_VIEW.radius*extent)];
}
export function anglePolyline(result:VectorAnalysis,extent:number):Vector2[]{
  if(result.angleRadians===null||!result.unitA||!result.unitB)return[];
  const radius=Math.min(42,Math.min(result.normA,result.normB)/extent*VECTOR_VIEW.radius*.4);
  if(radius<10)return[];
  const start=Math.atan2(result.vectorA[1],result.vectorA[0]);
  const signed=result.determinant<0?-result.angleRadians:result.angleRadians;
  return Array.from({length:33},(_,index)=>{const theta=start+signed*index/32;return[VECTOR_VIEW.cx+radius*Math.cos(theta),VECTOR_VIEW.cy-radius*Math.sin(theta)] as Vector2;});
}
