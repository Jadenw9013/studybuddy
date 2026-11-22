import 'dotenv/config';
import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

test('real relay keeps a long explanation intact after six ordinary uploads',async({page,browser})=>{
  if(process.env.RUN_PAID_VOICE_CONTINUITY!=='true')throw Error('Set RUN_PAID_VOICE_CONTINUITY=true for this explicit paid regression.');
  const reportPath='evals/live/results/voice-continuity.json';
  let history:any={runs:[]};try{history=JSON.parse(await readFile(reportPath,'utf8'));}catch{}
  if(history.runs.length>=2||(history.runs.length===1&&
    (process.env.VOICE_CONTINUITY_REVIEWED_RETRY!=='true'||history.runs[0].passed)))
    throw Error('One initial continuity run is allowed; one failed run may receive a root-reviewed retry, capped at two total.');
  const report:any={kind:'real-provider-browser-continuity',fixture:false,syntheticInput:true,humanParticipants:0,
    browser:browser.version(),startedAt:new Date().toISOString(),passed:false,checks:[],
    reviewedRetry:history.runs.length===1,
    gates:{realMicrophone:'open',usefulAudibleTeaching:'open',humanInterruptionLatency:'open',twentyMinuteLesson:'open',invoiceReconciliation:'open'}};
  history.runs.push(report);await mkdir('evals/live/results',{recursive:true});await writeFile(reportPath,JSON.stringify(history,null,2));
  let courseId='',lessonId='';
  const api=async(url:string,method='GET',data?:unknown)=>{
    const response=await page.request.fetch(url,{method,data,headers:{origin:'http://localhost:3000'}});
    expect(response.ok(),`${method} ${url} returned ${response.status()}`).toBe(true);return response.json();
  };
  try{
    const config=await api('/api/config');expect(config.mode).toBe('live');expect(config.authentication).toBe('local_test');expect(config.liveAvailable).toBe(true);
    const me=await api('/api/me');expect(me.remainingSeconds).toBeGreaterThanOrEqual(60);
    await page.addInitScript(()=>{
      const w=window as any;
      w.__continuity={startedAt:0,states:[],errors:[],audioPackets:0,audioSeconds:0,scheduledPackets:0,scheduledSeconds:0,
        naturallyEndedPackets:0,naturallyEndedSeconds:0,activeSources:0,stopCalls:0,peakQueueSeconds:0,
        lastScheduledEnd:0,lastPacketAt:0,manualInterruptMessages:0,reconnectingStates:0,interruptedMessages:0,
        socketOpen:false,firstPacketMs:null,firstScheduledMs:null};
      const Native=window.WebSocket;
      class Observed extends Native{
        constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);if(new URL(String(url)).pathname!=='/live')return;
          w.__continuitySocket=this;
          this.addEventListener('open',()=>{w.__continuity.socketOpen=true;});
          this.addEventListener('close',()=>{w.__continuity.socketOpen=false;});
          this.addEventListener('message',event=>{try{
            const m=JSON.parse(String(event.data)),e=w.__continuity;
            if(typeof m.turnEpoch==='number')e.epoch=m.turnEpoch;
            if(m.type==='state'){e.states.push(m.state);e.latestState=m.state;if(m.state==='reconnecting')e.reconnectingStates++;}
            if(m.type==='interrupted')e.interruptedMessages++;
            if(m.type==='error')e.errors.push(m.code);
            if(m.type==='audio'){
              const bytes=atob(m.data).length;
              e.audioPackets++;e.audioSeconds+=bytes/2/m.sampleRate;e.lastPacketAt=performance.now();
              e.firstPacketMs??=Math.round(performance.now()-e.startedAt);
            }
          }catch{}});
        }
        send(data:Parameters<WebSocket['send']>[0]){
          if(typeof data==='string')try{if(JSON.parse(data).type==='interrupt')w.__continuity.manualInterruptMessages++;}catch{}
          super.send(data);
        }
      }
      window.WebSocket=Observed;
      const make=AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource=function(){
        const source=make.call(this),start=source.start.bind(source),stop=source.stop.bind(source);
        let stopped=false,duration=0;
        source.addEventListener('ended',()=>{
          const e=w.__continuity;e.activeSources=Math.max(0,e.activeSources-1);
          if(!stopped){e.naturallyEndedPackets++;e.naturallyEndedSeconds+=duration;}
        });
        source.start=((when?:number,...args:any[])=>{
          const e=w.__continuity;duration=source.buffer?.duration??0;
          e.scheduledPackets++;e.scheduledSeconds+=duration;e.activeSources++;
          e.firstScheduledMs??=Math.round(performance.now()-e.startedAt);
          const end=(when??source.context.currentTime)+duration;
          e.lastScheduledEnd=Math.max(e.lastScheduledEnd,end);
          e.peakQueueSeconds=Math.max(e.peakQueueSeconds,end-source.context.currentTime);
          return(start as any)(when,...args);
        }) as typeof source.start;
        source.stop=((...args:any[])=>{stopped=true;w.__continuity.stopCalls++;return(stop as any)(...args);}) as typeof source.stop;
        return source;
      };
    });
    const course=await api('/api/courses','POST',{name:`Voice continuity ${randomUUID().slice(0,8)}`});courseId=course.id;
    const note='The vectors a = [3, 1] and b = [1, 2] share an origin. Their dot product is 5. Projection onto b has coordinates [1, 2]. A component perpendicular to b accounts for the remainder. The angle is 45 degrees.';
    const files=Array.from({length:6},(_,i)=>i<3?{name:`continuity-notes-${i+1}.txt`,mimeType:'text/plain',buffer:Buffer.from(`Course notes ${i+1}\n${note}\nDiscuss direction, length and projection geometrically.`)}:
      {name:`continuity-workbook-${i-2}.ipynb`,mimeType:'application/x-ipynb+json',buffer:Buffer.from(JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{},cells:[
        {id:`continuity-cell-${i}`,cell_type:'markdown',metadata:{},source:[`# Workbook ${i-2}\n`,note,'\nInterpret the parallel and perpendicular components without executing code.']}
      ]}))});
    for(let batch=0;batch<2;batch++){
      const response=await page.request.post(`/api/courses/${courseId}/uploads`,{headers:{origin:'http://localhost:3000'},
        multipart:Object.fromEntries(files.slice(batch*3,batch*3+3).map((file,index)=>[`file${index}`,file]))});
      expect(response.ok(),`ordinary upload batch ${batch+1}`).toBe(true);
    }
    await expect.poll(async()=>{
      const snapshot=await api(`/api/courses/${courseId}`);return snapshot.sources.filter((s:any)=>s.status.startsWith('ready')).length;
    },{timeout:45_000}).toBe(6);
    report.uploads={count:6,text:3,notebooks:3,pipeline:'ordinary private upload and ingestion',synthetic:true};
    const lesson=await api('/api/lessons','POST',{courseId,goal:'Direct explanation requested: create one vectors visual for vectorA=[3,1], vectorB=[1,2] with projection and angle. Then give a connected spoken explanation lasting about 15–20 seconds of the dot product, parallel projection and perpendicular remainder, using the exact computed values. Do not ask a diagnostic question or introduce yourself. Do not make a second diagram.'});lessonId=lesson.id;
    await page.goto(`/lessons/${lessonId}`);
    const voice=page.getByRole('button',{name:'Start live',exact:true});await expect(voice).toBeEnabled();
    await page.evaluate(()=>{(window as any).__continuity.startedAt=performance.now();});await voice.click();
    await page.evaluate(()=>{setTimeout(()=>{const s=(window as any).__continuitySocket;if(s?.readyState===1){s.send(JSON.stringify({type:'end'}));s.close(1000,'bounded_continuity_end');}},60_000);});
    await expect(page.getByTestId('vector-dot')).toHaveText('5',{timeout:15_000});
    await expect(page.getByTestId('vector-projection')).toContainText('[1, 2]');
    const initial=await api(`/api/lessons/${lessonId}`);
    expect(initial.lesson.board.vectorA).toEqual([3,1]);expect(initial.lesson.board.vectorB).toEqual([1,2]);
    await expect.poll(async()=>(await api(`/api/lessons/${lessonId}`)).lesson.paintedRevision,{timeout:3000}).toBe(initial.lesson.board.revision);
    report.firstCorrectVisibleChartProxyMs=await page.evaluate(()=>Math.round(performance.now()-(window as any).__continuity.startedAt));
    await expect.poll(()=>page.evaluate(()=>(window as any).__continuity.audioSeconds),{timeout:15_000}).toBeGreaterThan(5);
    await expect.poll(()=>page.evaluate(()=>{
      const e=(window as any).__continuity;return e.activeSources===0&&e.latestState==='listening'&&performance.now()-e.lastPacketAt>1000;
    }),{timeout:35_000}).toBe(true);
    const uninterrupted=await page.evaluate(()=>(window as any).__continuity);
    expect(uninterrupted.errors).toEqual([]);expect(uninterrupted.socketOpen).toBe(true);
    expect(uninterrupted.manualInterruptMessages).toBe(0);expect(uninterrupted.reconnectingStates).toBe(0);expect(uninterrupted.interruptedMessages).toBe(0);
    expect(uninterrupted.stopCalls).toBe(0);expect(uninterrupted.scheduledPackets).toBe(uninterrupted.audioPackets);
    expect(uninterrupted.naturallyEndedPackets).toBe(uninterrupted.scheduledPackets);
    expect(uninterrupted.scheduledSeconds).toBeGreaterThan(5);
    report.uninterrupted=uninterrupted;
    report.naturalBurstOverFiveSecondsObserved=uninterrupted.peakQueueSeconds>5;
    report.checks.push('more than five seconds of actual provider PCM scheduled and naturally drained with zero automatic interrupt/reconnect');
    const afterDrain=await api(`/api/lessons/${lessonId}`);
    expect(afterDrain.lesson.board.id).toBe(initial.lesson.board.id);expect(afterDrain.lesson.board.revision).toBe(initial.lesson.board.revision);
    report.checks.push('confirmed exact vector graph identity, revision and coordinates preserved through continuous speech');
    const packetsBeforeInterrupt=uninterrupted.audioPackets,epoch=uninterrupted.epoch;
    await page.getByRole('button',{name:'Interrupt tutor',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).__continuity.epoch),{timeout:5000}).toBeGreaterThan(epoch);
    await expect.poll(()=>page.evaluate(()=>(window as any).__continuity.latestState),{timeout:5000}).toBe('listening');
    // Timed silence is this protocol's observation window, not a simulated pass.
    await page.waitForTimeout(3000);
    const silent=await page.evaluate(()=>(window as any).__continuity);
    expect(silent.audioPackets).toBe(packetsBeforeInterrupt);expect(silent.manualInterruptMessages).toBe(1);expect(silent.reconnectingStates).toBe(1);
    report.silentRecovery={observationMs:3000,additionalPackets:silent.audioPackets-packetsBeforeInterrupt,reconnects:silent.reconnectingStates};
    report.checks.push('explicit interruption reconnected silently without repeating an introduction or restarting the explanation');
    await page.evaluate(()=>(window as any).__continuitySocket.send(JSON.stringify({type:'text',text:'For the vectors already on our board, say only their dot product aloud.'})));
    await expect.poll(()=>page.evaluate(()=>(window as any).__continuity.audioPackets),{timeout:8000}).toBeGreaterThan(packetsBeforeInterrupt);
    report.checks.push('a new learner question, rather than snapshot recovery, triggered subsequent actual provider audio');
    report.passed=true;
  }finally{
    await page.getByRole('button',{name:'Stop voice',exact:true}).first().click({timeout:1000}).catch(()=>{});
    report.finalEvidence=await page.evaluate(()=>(window as any).__continuity??null).catch(()=>null);
    if(report.finalEvidence?.errors?.length)report.passed=false;
    report.finishedAt=new Date().toISOString();
    report.measurement='PCM duration, AudioContext scheduling/drain, queue depth and UI timing proxies only; synthetic silence, no human audibility or invoice claim.';
    if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{origin:'http://localhost:3000'}}).then(r=>{report.courseCleanup=r.ok();}).catch(()=>{report.courseCleanup=false;});
    await writeFile(reportPath,JSON.stringify(history,null,2));
  }
});
