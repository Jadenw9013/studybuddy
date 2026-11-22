import {DomainError} from '../contracts/index.ts';

export type Vector2=[number,number];
export const MAX_VECTOR_COMPONENT=1_000_000;
export const MIN_VECTOR_COMPONENT=1e-100;
export interface VectorAnalysis {
  vectorA:Vector2;vectorB:Vector2;dot:number;determinant:number;normA:number;normB:number;
  sum:Vector2;difference:Vector2;unitA:Vector2|null;unitB:Vector2|null;
  cosine:number|null;angleRadians:number|null;angleDegrees:number|null;
  projectionCoefficient:number|null;scalarProjection:number|null;projection:Vector2|null;residual:Vector2|null;
  angleDefined:boolean;projectionDefined:boolean;relation:'acute'|'right'|'obtuse'|'undefined';
  angleReason:string|null;projectionReason:string|null;
}
function vector(value:unknown,name:string):Vector2{
  if(!Array.isArray(value)||value.length!==2||value.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>MAX_VECTOR_COMPONENT||(n!==0&&Math.abs(n)<MIN_VECTOR_COMPONENT)))
    throw new DomainError('invalid_params',`${name} needs two finite components, each at most 1,000,000 in magnitude. Use zero for a zero component; nonzero magnitudes below 10^-100 are outside this visual's numeric range.`,400);
  return value.map(n=>Object.is(n,-0)?0:n) as Vector2;
}
const clean=(value:number)=>Object.is(value,-0)?0:value;
const tuple=(x:number,y:number):Vector2=>[clean(x),clean(y)];

/** Euclidean dot product and projection of A ONTO B. Math follows MIT 18.013A §3.3:
 * https://www.ocw.mit.edu/ans7870/18/18.013a/textbook/chapter03/section03.html
 * atan2(|det|,dot) keeps near-parallel angles stable without acos-domain drift.
 * Bounds ensure all products, squared norms and coefficients remain finite.
 */
export function vectorAnalysis(a:unknown,b:unknown):VectorAnalysis{
  const vectorA=vector(a,'Vector a'),vectorB=vector(b,'Vector b');
  const [ax,ay]=vectorA,[bx,by]=vectorB;
  const dot=clean(ax*bx+ay*by),determinant=clean(ax*by-ay*bx);
  const normA=Math.hypot(ax,ay),normB=Math.hypot(bx,by);
  const unitA=normA?tuple(ax/normA,ay/normA):null,unitB=normB?tuple(bx/normB,by/normB):null;
  const angleDefined=Boolean(normA&&normB),projectionDefined=Boolean(normB);
  const angleRadians=angleDefined?Math.atan2(Math.abs(determinant),dot):null;
  const cosine=angleDefined?Math.max(-1,Math.min(1,dot/(normA*normB))):null;
  const projectionCoefficient=normB?dot/(bx*bx+by*by):null;
  const projection=projectionCoefficient===null?null:tuple(projectionCoefficient*bx,projectionCoefficient*by);
  return {vectorA,vectorB,dot,determinant,normA,normB,unitA,unitB,cosine,
    sum:tuple(ax+bx,ay+by),difference:tuple(ax-bx,ay-by),angleRadians,angleDegrees:angleRadians===null?null:angleRadians*180/Math.PI,
    projectionCoefficient,scalarProjection:normB?clean(dot/normB):null,projection,
    residual:projection?tuple(ax-projection[0],ay-projection[1]):null,
    angleDefined,projectionDefined,relation:angleDefined?(dot===0?'right':dot>0?'acute':'obtuse'):'undefined',
    angleReason:angleDefined?null:'The angle is undefined when either vector is zero.',
    projectionReason:projectionDefined?null:'Projection onto the zero vector is undefined because it has no direction.'};
}
