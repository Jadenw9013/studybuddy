import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorAnalysis} from './vectors.ts';
import {vectorViewport,vectorToSvg,svgToVector,anglePolyline,VECTOR_VIEW} from './vector-geometry.ts';
test('vector viewport uses the same scale on x and y and pointer mapping reverses the y axis',()=>{
  const {extent,tickStep}=vectorViewport(vectorAnalysis([2,2],[-1,3]));
  const [x,y]=vectorToSvg([2,2],extent);assert.equal(x-VECTOR_VIEW.cx,VECTOR_VIEW.cy-y);
  assert.deepEqual(svgToVector(x,y,extent,tickStep),[2,2]);
  assert.deepEqual(svgToVector(-1e9,1e9,extent,tickStep),[-extent,-extent]);
});
test('projection and zero vectors remain inside bounded grid with finite tick/arc data',()=>{
  for(const pair of [[[0,0],[0,0]],[[2,2],[-1,3]],[[1e-100,0],[0,1e-100]],[[1e6,-1e6],[-1e6,1e6]]] as [number[],number[]][]){
    const result=vectorAnalysis(...pair),view=vectorViewport(result);assert.ok(view.ticks.length<=17);assert.ok(view.extent>0&&Number.isFinite(view.extent));
    for(const point of [result.vectorA,result.vectorB,...(result.projection?[result.projection]:[])])assert.ok(point.every(v=>Math.abs(v)<view.extent));
    for(const point of anglePolyline(result,view.extent))assert.ok(point.every(Number.isFinite));
  }
});
