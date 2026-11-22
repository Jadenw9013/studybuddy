import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

test('real Gemini through browser relay: computed visual, playback, interrupt, frame forwarding and reconnect', async ({page,browser}) => {
  if (process.env.RUN_PAID_VOICE_BROWSER !== 'true') throw Error('Set RUN_PAID_VOICE_BROWSER=true for this explicit paid probe.');
  const reportPath='evals/live/results/voice-browser.json';
  let history:any={runs:[]};try{history=JSON.parse(await readFile(reportPath,'utf8'));}catch{}
  // Root reviewed the two preserved failures: no-minute admission, then a test
  // correlation bug (frame was forwarded, but metrics hash runId not lessonId).
  // Exactly one corrected run is authorized; no history reset or retry loop.
  if(history.runs.length>=3)throw Error('Three-run reviewed paid browser cap reached; no automatic further generation.');
  const report:any={kind:'real-gemini-local-app-browser-synthetic-microphone',fixture:false,syntheticInput:true,humanParticipants:0,
    browser:browser.version(),startedAt:new Date().toISOString(),passed:false,checks:[],
    gates:{realMicrophone:'open',usefulAudio:'open',screenQuestionAccuracy:'open',twentyMinuteLesson:'open',invoiceReconciliation:'open'}};
  history.runs.push(report);await mkdir(path.dirname(reportPath),{recursive:true});
  await writeFile(reportPath,JSON.stringify(history,null,2));
  let courseId='',lessonId='';
  const api=async(url:string,method='GET',data?:unknown)=>{
    const response=await page.request.fetch(url,{method,headers:{origin:'http://localhost:3000'},data});
    expect(response.ok(),`${method} ${url} returned ${response.status()}`).toBe(true);return response.json();
  };
  try {
    const config=await api('/api/config');
    expect(config.mode).toBe('live');expect(config.authentication).toBe('local_test');expect(config.liveAvailable).toBe(true);
    await page.addInitScript(()=>{
      const w=window as any;
      w.__voiceEvidence={startedAt:0,states:[],errors:[],audioPackets:0,scheduled:0,tools:[],epochs:[],firstPacket:null,firstSchedule:null,stops:0};
      const Native=window.WebSocket;
      class ObservedSocket extends Native {
        constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);if(new URL(String(url)).pathname!=='/live')return;
          w.__voiceSocket=this;
          this.addEventListener('message',event=>{try{
            const m=JSON.parse(String(event.data)),e=w.__voiceEvidence;
            if(typeof m.runId==='string'&&!e.runIdDigest&&!e.hashPending){
              e.hashPending=true;
              void crypto.subtle.digest('SHA-256',new TextEncoder().encode(m.runId)).then(buffer=>{
                e.runIdDigest=Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('');delete e.hashPending;
              });
            }
            if(typeof m.turnEpoch==='number'){e.epoch=m.turnEpoch;e.epochs.push(m.turnEpoch);}
            if(m.type==='state'){e.states.push(m.state);e.latestState=m.state;}
            if(m.type==='audio'){e.audioPackets++;e.firstPacket??=Math.round(performance.now()-e.startedAt);}
            if(m.type==='tool')e.tools.push(m.name);
            if(m.type==='error')e.errors.push(m.code);
          }catch{}});
        }
      }
      window.WebSocket=ObservedSocket;
      const make=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(){
        const source=make.call(this),start=source.start.bind(source),stop=source.stop.bind(source);
        source.start=((...args:any[])=>{const e=w.__voiceEvidence;e.scheduled++;e.firstSchedule??=Math.round(performance.now()-e.startedAt);return(start as any)(...args);}) as typeof source.start;
        source.stop=((...args:any[])=>{w.__voiceEvidence.stops++;return(stop as any)(...args);}) as typeof source.stop;
        return source;
      };
    });
    const course=await api('/api/courses','POST',{name:`Voice browser probe ${randomUUID().slice(0,8)}`});courseId=course.id;
    const lesson=await api('/api/lessons','POST',{courseId,goal:'Direct explanation requested: create a vectors visual using board.create for vectorA=[3,1], vectorB=[1,2], showing the projection and angle. Keep these exact coordinates. Briefly explain the computed result after its render receipt; no diagnostic question is needed.'});lessonId=lesson.id;
    await page.goto(`/lessons/${lessonId}`);
    const voice=page.getByRole('button',{name:'Start live',exact:true});await expect(voice).toBeEnabled();
    await page.evaluate(()=>{(window as any).__voiceEvidence.startedAt=performance.now();});
    await voice.click();
    // A browser-side hard stop bounds paid work even if a later assertion fails.
    await page.evaluate(()=>{setTimeout(()=>{const s=(window as any).__voiceSocket;if(s?.readyState===1){s.send(JSON.stringify({type:'end'}));s.close(1000,'bounded_probe_end');}},30_000);});
    await expect(page.getByTestId('vector-dot')).toHaveText('5',{timeout:15_000});
    await expect(page.getByTestId('vector-projection')).toContainText('[1, 2]');
    const shown=await api(`/api/lessons/${lessonId}`);
    expect(shown.lesson.board.vectorA).toEqual([3,1]);expect(shown.lesson.board.vectorB).toEqual([1,2]);
    await expect.poll(async()=> (await api(`/api/lessons/${lessonId}`)).lesson.paintedRevision,{timeout:3000}).toBe(shown.lesson.board.revision);
    report.firstCorrectVisibleChartProxyMs=await page.evaluate(()=>Math.round(performance.now()-(window as any).__voiceEvidence.startedAt));
    await expect.poll(()=>page.evaluate(()=>(window as any).__voiceEvidence.scheduled),{timeout:5000}).toBeGreaterThan(0);
    report.checks.push('provider board tool produced exact vector values; Chromium paint receipt and actual AudioContext scheduling');
    const oldEpoch=await page.evaluate(()=>(window as any).__voiceEvidence.epoch);
    await page.getByRole('button',{name:'Interrupt tutor',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__voiceEvidence.epoch),{timeout:5000}).toBeGreaterThan(oldEpoch);
    await expect.poll(()=>page.evaluate(()=>(window as any).__voiceEvidence.latestState),{timeout:5000}).toBe('listening');
    report.checks.push('explicit browser interruption advanced epoch and reconnected from confirmed state');
    const captureId=randomUUID(),frameId=randomUUID();
    await api(`/api/lessons/${lessonId}/capture`,'POST',{captureId,frameId});
    await page.evaluate(({captureId,frameId})=>{
      const canvas=document.createElement('canvas');canvas.width=480;canvas.height=160;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,480,160);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('Synthetic diagram: a = (3, 1); b = (1, 2)',15,70);
      (window as any).__voiceSocket.send(JSON.stringify({type:'frame',captureId,frameId,mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}));
    },{captureId,frameId});
    const hash=await page.evaluate(()=>(window as any).__voiceEvidence.runIdDigest);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await expect.poll(async()=>{
      try {const text=await readFile(path.resolve(process.env.DATA_DIR??'.data','live-metrics.jsonl'),'utf8');return text.split('\n').some(line=>{try{const e=JSON.parse(line);return e.runId===hash&&e.name==='frame_sent'&&e.fixture===false;}catch{return false;}});}catch{return false;}
    },{timeout:3000}).toBe(true);
    const epoch=await page.evaluate(()=>(window as any).__voiceEvidence.epoch);
    await page.evaluate(()=>(window as any).__voiceSocket.send(JSON.stringify({type:'reconnect'})));
    await expect.poll(()=>page.evaluate(()=>(window as any).__voiceEvidence.epoch),{timeout:5000}).toBeGreaterThan(epoch);
    await expect.poll(()=>page.evaluate(()=>(window as any).__voiceEvidence.latestState),{timeout:5000}).toBe('listening');
    const restored=await api(`/api/lessons/${lessonId}`);
    expect(restored.lesson.board.id).toBe(shown.lesson.board.id);expect(restored.lesson.board.revision).toBe(shown.lesson.board.revision);
    expect(restored.lesson.capture).toBeUndefined();
    report.checks.push('authorized synthetic PNG reached real provider; forced reconnect revoked capture and preserved board identity/revision');
    report.passed=true;
  } finally {
    await page.getByRole('button',{name:'Stop voice',exact:true}).first().click({timeout:1000}).catch(()=>{});
    report.browserEvidence=await page.evaluate(()=>(window as any).__voiceEvidence??null).catch(()=>null);
    if(report.browserEvidence?.errors?.length)report.passed=false;
    report.finishedAt=new Date().toISOString();
    report.measurement='Click-to-packet/scheduling/paint proxies with synthetic silence; no reviewer-marked useful audio or human interruption latency.';
    if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{origin:'http://localhost:3000'}}).then(r=>{report.courseCleanup=r.ok();}).catch(()=>{report.courseCleanup=false;});
    await writeFile(reportPath,JSON.stringify(history,null,2));
  }
});
