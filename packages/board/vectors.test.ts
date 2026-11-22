import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorAnalysis,MAX_VECTOR_COMPONENT} from './vectors.ts';
const near=(actual:number,expected:number,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),`${actual} is not near ${expected}`);

test('homework vectors [2,2] and [-1,3] retain exact dot, projection direction and decomposition',()=>{
  const r=vectorAnalysis([2,2],[-1,3]);assert.equal(r.dot,4);assert.equal(r.determinant,8);
  near(r.normA,Math.sqrt(8));near(r.normB,Math.sqrt(10));near(r.angleDegrees!,63.43494882292201);
  near(r.projectionCoefficient!,.4);near(r.projection![0],-.4);near(r.projection![1],1.2);
  near(r.residual![0],2.4);near(r.residual![1],.8);assert.equal(r.relation,'acute');
  near(r.residual![0]*r.vectorB[0]+r.residual![1]*r.vectorB[1],0);
});
test('right, opposite and parallel vectors have correct angles and signed projection',()=>{
  const right=vectorAnalysis([3,0],[0,4]);assert.equal(right.dot,0);assert.equal(right.angleDegrees,90);assert.deepEqual(right.projection,[0,0]);
  const opposite=vectorAnalysis([2,0],[-4,0]);assert.equal(opposite.angleDegrees,180);assert.equal(opposite.projectionCoefficient,-.5);assert.deepEqual(opposite.projection,[2,0]);
  assert.equal(vectorAnalysis([1,1],[3,3]).angleDegrees,0);
});
test('zero source has zero projection; zero target has undefined projection and angle',()=>{
  const a=vectorAnalysis([0,0],[2,3]);assert.equal(a.angleDegrees,null);assert.deepEqual(a.projection,[0,0]);assert.deepEqual(a.residual,[0,0]);
  const b=vectorAnalysis([2,3],[0,0]);assert.equal(b.projection,null);assert.equal(b.projectionCoefficient,null);assert.equal(b.angleDegrees,null);assert.match(b.projectionReason!,/zero vector/);
  const both=vectorAnalysis([0,0],[0,0]);assert.equal(both.dot,0);assert.equal(both.relation,'undefined');
});
test('near-parallel angles, bounded extremes and negative zero stay finite and serializable',()=>{
  const tinyAngle=vectorAnalysis([1,0],[1,1e-12]);near(tinyAngle.angleRadians!,1e-12,1e-15);assert.ok(tinyAngle.angleRadians!>0);
  for(const [a,b]of [[[1e-100,0],[0,1e-100]],[[MAX_VECTOR_COMPONENT,MAX_VECTOR_COMPONENT],[1e-100,-1e-100]]] as [number[],number[]][]){
    const r=vectorAnalysis(a,b);assert.ok(Number.isFinite(r.dot));assert.ok(Number.isFinite(r.normA));assert.ok(Number.isFinite(r.projectionCoefficient));
  }
  assert.deepEqual(vectorAnalysis([-0,2],[3,-0]).vectorA,[0,2]);
});
test('rejects malformed, nonfinite or unsupported-scale inputs at trusted numeric boundary',()=>{
  for(const bad of [[1], [1,2,3], ['2',2], [NaN,1], [Infinity,2], [1e7,0], [1e-200,0], null])assert.throws(()=>vectorAnalysis(bad,[1,0]),/two finite components/);
});
test('generated vector invariants: symmetry, projection orthogonality, decomposition and Pythagoras',()=>{
  let seed=19071;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed%2001-1000)/10;};
  for(let i=0;i<250;i++){
    const a=[random(),random()],b=[random(),random()],r=vectorAnalysis(a,b),swap=vectorAnalysis(b,a);
    assert.equal(r.dot,swap.dot);near(r.angleRadians!,swap.angleRadians!);
    if(r.projection){near(r.projection[0]+r.residual![0],a[0]);near(r.projection[1]+r.residual![1],a[1]);
      near(r.residual![0]*b[0]+r.residual![1]*b[1],0,1e-9);
      near(r.projection[0]**2+r.projection[1]**2+r.residual![0]**2+r.residual![1]**2,r.normA**2,1e-10);
    }
  }
});
