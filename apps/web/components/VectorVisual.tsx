"use client";
import {useEffect,useId,useRef,useState,type PointerEvent,type KeyboardEvent} from 'react';
import {vectorAnalysis,MIN_VECTOR_COMPONENT,type VectorAnalysis,type Vector2} from '../../../packages/board/vectors.ts';
import {vectorViewport,vectorToSvg,svgToVector,anglePolyline,VECTOR_VIEW} from '../../../packages/board/vector-geometry.ts';

export type VectorPatch={vectorA?:Vector2;vectorB?:Vector2;showProjection?:boolean;showAngle?:boolean};
type Board={id:string;revision:number;label?:string;vectorA?:Vector2;vectorB?:Vector2;showProjection?:boolean;showAngle?:boolean;result:VectorAnalysis};
type Draft={id:string;revision:number;vectorA:Vector2;vectorB:Vector2};
const format=(value:number|null)=>value===null?'undefined':Number(value.toPrecision(6)).toString();
const pair=(value:Vector2|null)=>value?`[${format(value[0])}, ${format(value[1])}]`:'undefined';
const colors={a:'var(--visual-a, #6d8cff)',b:'var(--visual-b, #26c7b7)',projection:'var(--visual-projection, #eeb86c)',grid:'var(--visual-grid, #354056)'};

/** Typed coordinates only. SVG never consumes model-authored markup or scripts.
 * Numeric controls and the data table provide equivalent keyboard/text access:
 * https://www.w3.org/WAI/tutorials/images/complex/
 */
export default function VectorVisual({board,onPatch,onPaint}:{board:Board;onPatch?:(args:VectorPatch)=>void|Promise<unknown>;onPaint?:(revision:number)=>void}){
  const id=useId().replace(/:/g,''),svg=useRef<SVGSVGElement>(null),confirmed=board.result;
  const [draft,setDraft]=useState<Draft|null>(null),draftRef=useRef<Draft|null>(null);
  const [fields,setFields]=useState<{id:string;revision:number;values:string[]}|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[dragging,setDragging]=useState(false);
  const pointer=useRef<{id:number;vector:'vectorA'|'vectorB'}|null>(null);
  const paintCallback=useRef(onPaint);paintCallback.current=onPaint;
  const currentDraft=draft?.id===board.id&&draft.revision===board.revision?draft:null;
  const formFields=fields?.id===board.id&&fields.revision===board.revision?fields.values:[...confirmed.vectorA,...confirmed.vectorB].map(String);
  let formAnalysis:VectorAnalysis|null=null;
  if(fields?.id===board.id&&fields.revision===board.revision&&formFields.every(value=>value.trim()!==''))try{formAnalysis=vectorAnalysis(formFields.slice(0,2).map(Number),formFields.slice(2).map(Number));}catch{}
  const preview=currentDraft?vectorAnalysis(currentDraft.vectorA,currentDraft.vectorB):formAnalysis??confirmed;
  const dirty=Boolean(currentDraft||(fields?.id===board.id&&fields.revision===board.revision));
  const viewport=vectorViewport(confirmed),point=(v:Vector2)=>vectorToSvg(v,viewport.extent);
  const a=point(preview.vectorA),b=point(preview.vectorB),projection=preview.projection?point(preview.projection):null;
  const showProjection=board.showProjection!==false,showAngle=board.showAngle!==false;
  const arc=showAngle?anglePolyline(preview,viewport.extent):[];
  useEffect(()=>{setDraft(null);draftRef.current=null;setFields(null);setError('');pointer.current=null;setDragging(false);},[board.id,board.revision]);
  useEffect(()=>{let second=0;const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>paintCallback.current?.(board.revision));});return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};},[board.id,board.revision]);
  const reset=()=>{setDraft(null);draftRef.current=null;setFields(null);setError('');};
  const local=(vectorA:Vector2,vectorB:Vector2)=>{const next={id:board.id,revision:board.revision,vectorA,vectorB};draftRef.current=next;setDraft(next);setFields({id:board.id,revision:board.revision,values:[...vectorA,...vectorB].map(String)});};
  const save=async(args:VectorPatch)=>{if(!onPatch||saving)return;setSaving(true);setError('');try{await onPatch(args);}catch(e){setError(e instanceof Error?e.message:'The vector change could not be saved. Try again from the current board.');}finally{setSaving(false);}};
  const fromEvent=(event:PointerEvent<SVGGElement>)=>{const matrix=svg.current?.getScreenCTM();if(!matrix||!svg.current)return null;const p=svg.current.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const mapped=p.matrixTransform(matrix.inverse());return svgToVector(mapped.x,mapped.y,viewport.extent,viewport.tickStep);};
  const move=(event:PointerEvent<SVGGElement>)=>{if(!pointer.current||pointer.current.id!==event.pointerId)return;const value=fromEvent(event);if(!value)return;const previous=draftRef.current??{vectorA:preview.vectorA,vectorB:preview.vectorB};local(pointer.current.vector==='vectorA'?value:previous.vectorA,pointer.current.vector==='vectorB'?value:previous.vectorB);};
  const start=(event:PointerEvent<SVGGElement>,vector:'vectorA'|'vectorB')=>{if(!onPatch||saving||pointer.current)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);pointer.current={id:event.pointerId,vector};setDragging(true);};
  const end=(event:PointerEvent<SVGGElement>)=>{if(!pointer.current||pointer.current.id!==event.pointerId)return;move(event);pointer.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);const next=draftRef.current;if(next)void save({vectorA:next.vectorA,vectorB:next.vectorB});};
  const cancel=()=>{pointer.current=null;setDragging(false);reset();};
  const keyMove=(event:KeyboardEvent<SVGGElement>,vector:'vectorA'|'vectorB')=>{
    if(!onPatch||saving)return;
    if(event.key==='Escape'){event.preventDefault();reset();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();const next=draftRef.current;if(next)void save({vectorA:next.vectorA,vectorB:next.vectorB});return;}
    const delta:Record<string,Vector2>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!delta[event.key])return;
    event.preventDefault();const previous=draftRef.current??{vectorA:preview.vectorA,vectorB:preview.vectorB},value=[...previous[vector]] as Vector2,step=viewport.tickStep/10*(event.shiftKey?10:1);
    value[0]=Math.max(-1e6,Math.min(1e6,Number((value[0]+delta[event.key][0]*step).toPrecision(12))));value[1]=Math.max(-1e6,Math.min(1e6,Number((value[1]+delta[event.key][1]*step).toPrecision(12))));
    value[0]=Math.abs(value[0])<MIN_VECTOR_COMPONENT?0:value[0];value[1]=Math.abs(value[1])<MIN_VECTOR_COMPONENT?0:value[1];
    local(vector==='vectorA'?value:previous.vectorA,vector==='vectorB'?value:previous.vectorB);
  };
  const arrow=(to:Vector2,color:string,marker:string,dash?:string)=> <line x1={VECTOR_VIEW.cx} y1={VECTOR_VIEW.cy} x2={to[0]} y2={to[1]} stroke={color} strokeWidth="3" strokeDasharray={dash} markerEnd={`url(#${id}-${marker})`}/>;
  const handle=(name:'vectorA'|'vectorB',position:Vector2)=> <g className="visual-handle" role="button" tabIndex={onPatch?0:-1} aria-label={`Move vector ${name==='vectorA'?'a':'b'} endpoint. Arrow keys move; Enter applies; Escape cancels.`} aria-disabled={!onPatch||saving} onKeyDown={e=>keyMove(e,name)} onPointerDown={e=>start(e,name)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} style={{cursor:onPatch?'grab':'default',touchAction:'none'}}><circle cx={position[0]} cy={position[1]} r="22" fill="transparent"/><circle cx={position[0]} cy={position[1]} r="5.5" fill={name==='vectorA'?colors.a:colors.b} stroke="var(--visual-plane, #101a2b)" strokeWidth="2"/></g>;
  return <section className="visual-vectors" aria-label="Vector diagram and calculations" aria-busy={saving}>
    <div className="visual-heading"><div><h3>{board.label||'Two vectors, one coordinate plane'}</h3><p>Dot product, angle, and the projection of a onto b.</p></div><span className="visual-revision">Revision {board.revision}</span></div>
    <figure className="visual-figure">
      <svg ref={svg} className="visual-vector-svg" viewBox={`0 0 ${VECTOR_VIEW.width} ${VECTOR_VIEW.height}`} width="100%" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
        <title id={`${id}-title`}>Vectors a {pair(preview.vectorA)} and b {pair(preview.vectorB)}</title>
        <desc id={`${id}-description`}>Both axes use the same unit scale. Solid arrows are a and b. The dashed arrow is the projection of a onto b; the dotted segment is the perpendicular residual. Calculations and coordinates follow the diagram.</desc>
        <defs>{(['a','b','projection'] as const).map(name=><marker key={name} id={`${id}-${name}`} markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L7 3.5 L0 7 Z" fill={colors[name]}/></marker>)}</defs>
        <rect x="104" y="34" width="352" height="352" rx="12" fill="var(--visual-plane, #101a2b)"/>
        {viewport.ticks.map(tick=>{const p=point([tick,tick]);return <g key={tick} aria-hidden="true"><line x1={p[0]} x2={p[0]} y1="44" y2="376" stroke={colors.grid} strokeOpacity=".55"/><line x1="114" x2="446" y1={p[1]} y2={p[1]} stroke={colors.grid} strokeOpacity=".55"/>{tick!==0&&<><text className="visual-axis-label" x={p[0]} y={VECTOR_VIEW.cy+18} textAnchor="middle" fill="var(--visual-muted, #a7b4ca)" fontSize="11">{format(tick)}</text><text className="visual-axis-label" x={VECTOR_VIEW.cx-10} y={p[1]+4} textAnchor="end" fill="var(--visual-muted, #a7b4ca)" fontSize="11">{format(tick)}</text></>}</g>;})}
        <g aria-hidden="true"><line x1="105" x2="455" y1={VECTOR_VIEW.cy} y2={VECTOR_VIEW.cy} stroke="var(--visual-muted, #a7b4ca)"/><line x1={VECTOR_VIEW.cx} x2={VECTOR_VIEW.cx} y1="35" y2="385" stroke="var(--visual-muted, #a7b4ca)"/><text x="466" y={VECTOR_VIEW.cy+5} fill="var(--visual-text, #dce5f6)" fontSize="13">x</text><text x={VECTOR_VIEW.cx+10} y="26" fill="var(--visual-text, #dce5f6)" fontSize="13">y</text><text x={VECTOR_VIEW.cx-10} y={VECTOR_VIEW.cy+17} textAnchor="end" fill="var(--visual-muted, #a7b4ca)" fontSize="11">0</text></g>
        {showProjection&&preview.unitB&&<line x1={point([preview.unitB[0]*viewport.extent,preview.unitB[1]*viewport.extent])[0]} y1={point([preview.unitB[0]*viewport.extent,preview.unitB[1]*viewport.extent])[1]} x2={point([-preview.unitB[0]*viewport.extent,-preview.unitB[1]*viewport.extent])[0]} y2={point([-preview.unitB[0]*viewport.extent,-preview.unitB[1]*viewport.extent])[1]} stroke={colors.b} strokeDasharray="2 5" opacity=".4"/>}
        {showProjection&&projection&&<g>{arrow(projection,colors.projection,'projection','6 4')}<line x1={projection[0]} y1={projection[1]} x2={a[0]} y2={a[1]} stroke={colors.projection} strokeDasharray="2 5" strokeWidth="2"/><circle cx={projection[0]} cy={projection[1]} r="4" fill={colors.projection}/></g>}
        {arc.length>0&&<polyline points={arc.map(p=>p.join(',')).join(' ')} fill="none" stroke="var(--visual-angle, #c7a4ff)" strokeWidth="2"/>}
        {arrow(a,colors.a,'a')}{arrow(b,colors.b,'b')}
        <text x={a[0]+(preview.vectorA[0]<0?-10:10)} y={a[1]-12} textAnchor={preview.vectorA[0]<0?'end':'start'} fill={colors.a} fontSize="13" fontWeight="600">a {pair(preview.vectorA)}</text>
        <text x={b[0]+(preview.vectorB[0]<0?-10:10)} y={b[1]+23} textAnchor={preview.vectorB[0]<0?'end':'start'} fill={colors.b} fontSize="13" fontWeight="600">b {pair(preview.vectorB)}</text>
        {handle('vectorA',a)}{handle('vectorB',b)}
      </svg>
      <figcaption className="visual-legend"><span style={{color:colors.a}}>a: solid arrow</span><span style={{color:colors.b}}>b: solid arrow</span>{showProjection&&<span style={{color:colors.projection}}>Projection: dashed arrow</span>}{showAngle&&preview.angleDegrees!==null&&<span>Angle ≈ {format(preview.angleDegrees)}°</span>}</figcaption>
    </figure>
    <dl className="visual-metrics"><div><dt>a · b</dt><dd data-testid="vector-dot">{format(preview.dot)}</dd></div><div><dt>‖a‖</dt><dd>{format(preview.normA)}</dd></div><div><dt>‖b‖</dt><dd>{format(preview.normB)}</dd></div><div><dt>Angle</dt><dd data-testid="vector-angle">{preview.angleDegrees===null?'undefined':`${format(preview.angleDegrees)}°`}</dd></div></dl>
    <p className="visual-explanation" data-testid="vector-projection">{preview.projectionDefined?<>proj<sub>b</sub>(a) = (a · b / ‖b‖²)b = {format(preview.projectionCoefficient)}b = {pair(preview.projection)}.</>:preview.projectionReason} {preview.angleReason}</p>
    {onPatch&&<><p className="visual-help">Drag an endpoint to explore, or enter exact coordinates. Arrow keys move a focused endpoint; Enter applies.</p><form className="visual-vector-controls" onSubmit={event=>{event.preventDefault();if(formFields.some(value=>!value.trim())){setError('Enter all four coordinates.');return;}try{const result=vectorAnalysis(formFields.slice(0,2).map(Number),formFields.slice(2).map(Number));void save({vectorA:result.vectorA,vectorB:result.vectorB});}catch(e){setError(e instanceof Error?e.message:'Use finite numeric coordinates.');}}}>
      {(['a','b'] as const).map((name,index)=><fieldset key={name}><legend>Vector {name}</legend>{['x','y'].map((axis,coordinate)=><label key={axis} htmlFor={`${id}-${name}-${axis}`}>{axis}<input id={`${id}-${name}-${axis}`} aria-label={`Vector ${name} ${axis}`} type="number" step="any" min={-1e6} max={1e6} required disabled={saving||dragging} value={formFields[index*2+coordinate]} onChange={event=>{const values=[...formFields];values[index*2+coordinate]=event.target.value;setFields({id:board.id,revision:board.revision,values});setDraft(null);draftRef.current=null;}}/></label>)}</fieldset>)}
      <div className="visual-actions"><button type="submit" disabled={saving||dragging||!dirty}>{saving?'Saving…':'Apply coordinates'}</button><button type="button" className="text-button" disabled={saving||!dirty} onClick={reset}>Reset preview</button></div>
    </form><div className="visual-display-controls"><label><input type="checkbox" checked={showProjection} disabled={saving||dirty} onChange={event=>void save({showProjection:event.target.checked})}/>Show projection onto b</label><label><input type="checkbox" checked={showAngle} disabled={saving||dirty} onChange={event=>void save({showAngle:event.target.checked})}/>Show angle</label></div></>}
    {dirty&&<p className="visual-preview-note" role="status">Preview coordinates. {dragging?'Release to save this vector change.':'Apply to save the new board revision.'}</p>}{error&&<p className="visual-error" role="alert">{error}</p>}
    <details className="visual-data"><summary>Coordinates and computed values</summary><p>Displayed decimals are rounded to six significant digits. Both axes use the same scale.</p><div className="table-scroll"><table><caption>Vector calculations for {dirty?'local preview':`board revision ${board.revision}`}</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Value</th></tr></thead><tbody>{[['a',pair(preview.vectorA)],['b',pair(preview.vectorB)],['a + b',pair(preview.sum)],['a − b',pair(preview.difference)],['a · b',format(preview.dot)],['cos(angle)',format(preview.cosine)],['Projection of a onto b',pair(preview.projection)],['Residual a − projection',pair(preview.residual)]].map(([label,value])=><tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody></table></div></details>
  </section>;
}
