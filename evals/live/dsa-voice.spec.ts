import 'dotenv/config';
import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

test('real DSA voice opens the correct graph, paces steps, switches traversal and reversibly changes source',async({page,browser})=>{
  if(process.env.RUN_PAID_DSA_VOICE!=='true')throw Error('Set RUN_PAID_DSA_VOICE=true for this explicitly paid suite.');
  const file='evals/live/results/dsa-voice.json';let history:any={runs:[]};try{history=JSON.parse(await readFile(file,'utf8'));}catch{}
  const priorCount=history.runs.length;
  const reviewedRetry=priorCount===1&&process.env.DSA_VOICE_REVIEWED_RETRY==='true'&&history.runs[0].passed===false;
  const reviewedProductFix=priorCount===2&&history.runs.every((run:any)=>run.passed===false)&&process.env.DSA_VOICE_REVIEWED_PRODUCT_FIX==='lesson-load-guard';
  const reviewedToolRecovery=priorCount===3&&history.runs.every((run:any)=>run.passed===false)&&process.env.DSA_VOICE_REVIEWED_PRODUCT_FIX==='visual-tool-recovery';
  if(priorCount>=4||!(priorCount===0||reviewedRetry||reviewedProductFix||reviewedToolRecovery))
    throw Error('A maximum of four individually reviewed runs is allowed. The fourth requires the exact visual-tool-recovery product fix and all three prior failed records. No automatic retries.');
  const report:any={kind:'real-provider-dsa-browser',fixture:false,syntheticInput:true,humanParticipants:0,browser:browser.version(),
    startedAt:new Date().toISOString(),passed:false,checks:[],reviewedRetry,
    gates:{realMicrophone:'open',usefulAudibleTeaching:'open',humanInterruptionLatency:'open',twentyMinuteLesson:'open',invoiceReconciliation:'open'},
    ...(reviewedRetry?{reviewedFailureReason:history.runs[0].reviewedFailureReason}:{}),
    ...(reviewedProductFix?{reviewedProductFix:'lesson-load-guard',reviewedFailureReason:history.runs[1].productFixReview,priorFailedRuns:2}:{}),};
  if(reviewedToolRecovery)Object.assign(report,{reviewedProductFix:'visual-tool-recovery',priorFailedRuns:3,
    reviewedFailureReason:'Root reviewed observed unsolicited DFS advancement and repeated rejected graph-to-tree calls. Trusted one-visual-per-learner-turn enforcement, source-specific tool guidance, typed error recovery and a two-failure stop were implemented and tested. This is one bounded post-fix verification; all prior failures remain retained, with stricter post-playback state checks.'});
  history.runs.push(report);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(history,null,2));
  let courseId='',lessonId='';
  const api=async(url:string,method='GET',data?:unknown)=>{const response=await page.request.fetch(url,{method,data,headers:{origin:'http://localhost:3000'}});
    expect(response.ok(),`${method} ${url} returned ${response.status()}`).toBe(true);return response.json();};
  const board=async()=>(await api(`/api/lessons/${lessonId}`)).lesson.board;
  try{
    const config=await api('/api/config');expect(config.mode).toBe('live');expect(config.authentication).toBe('local_test');expect(config.liveAvailable).toBe(true);
    expect((await api('/api/me')).remainingSeconds).toBeGreaterThanOrEqual(75);
    await page.addInitScript(()=>{
      const w=window as any;w.__dsaVoice={startedAt:0,states:[],errors:[],tools:[],audioPackets:0,scheduledPackets:0,activeSources:0,stopCalls:0,
        lastPacketAt:0,lastListeningAt:0,firstAudioMs:null,firstScheduledMs:null,textRequests:0,socketOpen:false,
        usageEvents:[],usageDuplicateCount:0,usageInvalidCount:0,usageHashFailures:0};
      const seenUsage=new Set<string>();w.__dsaUsageHashes=[];
      const Native=window.WebSocket;
      class Observed extends Native{
        constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);if(new URL(String(url)).pathname!=='/live')return;w.__dsaVoiceSocket=this;
          this.addEventListener('open',()=>{w.__dsaVoice.socketOpen=true;});this.addEventListener('close',()=>{w.__dsaVoice.socketOpen=false;});
          this.addEventListener('message',event=>{try{const m=JSON.parse(String(event.data)),e=w.__dsaVoice;
            if(typeof m.runId==='string'&&!e.runDigest&&!e.hashPending){e.hashPending=true;void crypto.subtle.digest('SHA-256',new TextEncoder().encode(m.runId)).then(buffer=>{
              e.runDigest=Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('');delete e.hashPending;});}
            if(typeof m.turnEpoch==='number')e.epoch=m.turnEpoch;
            if(m.type==='state'){e.states.push(m.state);e.latestState=m.state;if(m.state==='listening')e.lastListeningAt=performance.now();}
            if(m.type==='error')e.errors.push(m.code);
            if(m.type==='usage'){
              const usage=m.usage,eventId=usage?.eventId;
              if(typeof eventId!=='string'||!/^[a-f0-9]{64}$/.test(eventId))e.usageInvalidCount++;
              else if(seenUsage.has(eventId))e.usageDuplicateCount++;
              else{
                seenUsage.add(eventId);
                const raw=usage.rawUsageMetadata??usage;
                const numeric=(value:any)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
                const details=(items:any)=>Array.isArray(items)?items.filter(item=>['TEXT','AUDIO','IMAGE','DOCUMENT','VIDEO','UNKNOWN'].includes(item?.modality)&&numeric(item?.tokenCount)!==null)
                  .map(item=>({modality:item.modality,tokenCount:item.tokenCount})):null;
                const observation:any={ordinal:e.usageEvents.length+1,turnEpoch:numeric(usage.turnEpoch??m.turnEpoch),turnSequence:numeric(m.turnSequence),
                  promptTokenCount:numeric(raw.promptTokenCount),responseTokenCount:numeric(raw.responseTokenCount),totalTokenCount:numeric(raw.totalTokenCount),
                  cachedContentTokenCount:numeric(raw.cachedContentTokenCount),thoughtsTokenCount:numeric(raw.thoughtsTokenCount),
                  inputModalities:details(raw.promptTokensDetails),outputModalities:details(raw.responseTokensDetails),cachedModalities:details(raw.cacheTokensDetails)};
                e.usageEvents.push(observation);
                w.__dsaUsageHashes.push(crypto.subtle.digest('SHA-256',new TextEncoder().encode(eventId)).then(buffer=>{
                  observation.eventIdDigest=Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join('');
                }).catch(()=>{e.usageHashFailures++;}));
              }
            }
            if(m.type==='tool')e.tools.push({name:m.name,wallAt:Date.now(),epoch:m.turnEpoch,atMs:Math.round(performance.now()-e.startedAt),revision:m.result?.revision,kind:m.result?.board?.kind,algorithm:m.result?.board?.algorithm,stepIndex:m.result?.board?.result?.stepIndex});
            if(m.type==='audio'){e.audioPackets++;e.lastPacketAt=performance.now();e.firstAudioMs??=Math.round(performance.now()-e.startedAt);}
          }catch{}});
        }
        send(data:Parameters<WebSocket['send']>[0]){if(typeof data==='string')try{if(JSON.parse(data).type==='text')w.__dsaVoice.textRequests++;}catch{}super.send(data);}
      }
      window.WebSocket=Observed;
      const make=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const source=make.call(this),start=source.start.bind(source),stop=source.stop.bind(source);
        source.addEventListener('ended',()=>{w.__dsaVoice.activeSources=Math.max(0,w.__dsaVoice.activeSources-1);});
        source.start=((...args:any[])=>{const e=w.__dsaVoice;e.scheduledPackets++;e.activeSources++;e.firstScheduledMs??=Math.round(performance.now()-e.startedAt);return(start as any)(...args);}) as typeof source.start;
        source.stop=((...args:any[])=>{w.__dsaVoice.stopCalls++;return(stop as any)(...args);}) as typeof source.stop;return source;};
    });
    const course=await api('/api/courses','POST',{name:`DSA voice ${randomUUID().slice(0,8)}`});courseId=course.id;
    const names=['01-undirected-graph.json','02-directed-graph.json','03-binary-tree.json','04-binary-search-tree.json','05-study-guide.md'];
    for(let start=0;start<names.length;start+=3){const files=await Promise.all(names.slice(start,start+3).map(async name=>({name,mimeType:name.endsWith('.json')?'application/json':'text/markdown',buffer:await readFile(path.resolve('fixtures/dsa',name))})));
      const response=await page.request.post(`/api/courses/${courseId}/uploads`,{headers:{origin:'http://localhost:3000'},multipart:Object.fromEntries(files.map((value,index)=>[`file${index}`,value]))});expect(response.ok()).toBe(true);}
    await expect.poll(async()=>{const data=await api(`/api/courses/${courseId}`);return data.sources.filter((s:any)=>s.status.startsWith('ready')).length;},{timeout:45_000}).toBe(5);
    const sources=(await api(`/api/courses/${courseId}`)).sources,graph=sources.find((s:any)=>s.name===names[0]),tree=sources.find((s:any)=>s.name===names[2]);
    expect(graph.dsa.kind).toBe('graph');expect(graph.dsa.directed).toBe(false);expect(tree.dsa.kind).toBe('binary_tree');
    report.uploads={count:5,structuredDsa:4,studyGuide:1,pipeline:'ordinary private upload and ingestion',synthetic:true};
    const lesson=await api('/api/lessons','POST',{courseId,goal:'Explain BFS on the undirected mock graph with its nodes and queue. Keep each spoken answer brief and explain only the displayed step.'});lessonId=lesson.id;
    await page.goto(`/lessons/${lessonId}`);
    const close=page.getByRole('button',{name:'Close workspace',exact:true});if(await close.isVisible())await close.click();
    await expect(page.getByRole('complementary',{name:'Lesson workspace',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Start live',exact:true})).toBeEnabled();await page.evaluate(()=>{(window as any).__dsaVoice.startedAt=performance.now();});
    await page.getByRole('button',{name:'Start live',exact:true}).click();
    await page.evaluate(()=>{setTimeout(()=>{const s=(window as any).__dsaVoiceSocket;if(s?.readyState===1){s.send(JSON.stringify({type:'end'}));s.close(1000,'bounded_dsa_voice_end');}},75_000);});
    await expect(page.getByTestId('dsa-svg')).toBeVisible({timeout:15_000});
    await expect.poll(async()=>{const b=await board();return[b.kind,b.sourceId,b.result.algorithm,b.result.stepIndex];},{timeout:5000}).toEqual(['dsa',graph.id,'bfs',0]);
    const initial=await board(),boardId=initial.id;
    await expect.poll(async()=>(await api(`/api/lessons/${lessonId}`)).lesson.paintedRevision,{timeout:3000}).toBe(initial.revision);
    await expect(page.getByTestId('dsa-step')).toContainText('Step 0');await expect(page.getByRole('region',{name:'Graph and tree algorithm visualization',exact:true}).getByText('Mock teaching dataset',{exact:true})).toBeVisible();
    report.firstVisualProxyMs=await page.evaluate(()=>Math.round(performance.now()-(window as any).__dsaVoice.startedAt));
    report.phases=[];
    const finishPhase=async(name:string,expected:{sourceId:string;algorithm:string;stepIndex:number},permittedTools:string|string[],baseline:{packets:number;scheduled:number;since:number})=>{
      const toolNames=Array.isArray(permittedTools)?permittedTools:[permittedTools];
      await expect.poll(async()=>{const b=await board();return[b.id,b.sourceId,b.result.algorithm,b.result.stepIndex];},{timeout:12_000})
        .toEqual([boardId,expected.sourceId,expected.algorithm,expected.stepIndex]);
      const current=await board();
      await expect.poll(async()=>(await api(`/api/lessons/${lessonId}`)).lesson.paintedRevision,{timeout:3000}).toBe(current.revision);
      let observedTool:any,ordering:any;
      await expect.poll(()=>page.evaluate(({revision,toolNames})=>{
        return(window as any).__dsaVoice.tools.some((t:any)=>toolNames.includes(t.name)&&t.revision===revision);
      },{revision:current.revision,toolNames}),{timeout:3000}).toBe(true);
      observedTool=await page.evaluate(({revision,toolNames})=>(window as any).__dsaVoice.tools.find((t:any)=>toolNames.includes(t.name)&&t.revision===revision),{revision:current.revision,toolNames});
      // One board mutation per learner turn in this isolated unpaired lesson.
      // Create/replace are sanitized as 'other'; course.search is separately named.
      const expectedCodes=observedTool.name==='board.patch'?['board.patch']:[observedTool.name,'other'];
      await expect.poll(async()=>{try{
        const digest=await page.evaluate(()=>(window as any).__dsaVoice.runDigest);
        const events=(await readFile(path.resolve(process.env.DATA_DIR??'.data','live-metrics.jsonl'),'utf8')).split('\n').flatMap(line=>{try{
          const e=JSON.parse(line);return e.runId===digest&&e.fixture===false&&e.turnEpoch===observedTool.epoch&&e.at>=baseline.since?[e]:[];
        }catch{return[];}});
        const paint=events.find(e=>e.name==='board_render_proxy'),tool=events.find(e=>e.name==='tool_completed'&&expectedCodes.includes(e.code)&&paint&&e.at>=paint.at);
        if(!paint||!tool||!events.some(e=>e.name==='audio_packet'&&e.at>=tool.at))return false;
        ordering={paintAt:paint.at,toolResponseCallCompletedAt:tool.at,postReceiptPcm:true};return true;
      }catch{return false;}},{timeout:12_000}).toBe(true);
      await expect.poll(()=>page.evaluate(({packets,scheduled,epoch})=>{
        const e=(window as any).__dsaVoice;
        return e.socketOpen&&e.errors.length===0&&e.epoch===epoch&&e.audioPackets>packets&&e.scheduledPackets>scheduled&&
          e.latestState==='listening'&&e.lastListeningAt>=e.lastPacketAt&&e.activeSources===0&&performance.now()-e.lastPacketAt>=500;
      },{...baseline,epoch:observedTool.epoch}),{timeout:20_000}).toBe(true);
      const evidence=await page.evaluate(()=>(window as any).__dsaVoice);expect(evidence.errors).toEqual([]);expect(evidence.stopCalls).toBe(0);
      // A successful early frame does not excuse an unsolicited later advance.
      const settledBoard=await board();
      expect([settledBoard.id,settledBoard.sourceId,settledBoard.result.algorithm,settledBoard.result.stepIndex])
        .toEqual([boardId,expected.sourceId,expected.algorithm,expected.stepIndex]);
      report.phases.push({name,toolName:observedTool.name,revision:current.revision,epoch:observedTool.epoch,algorithm:current.result.algorithm,stepIndex:current.result.stepIndex,
        paintAndResponseOrdering:ordering,newAudioPackets:evidence.audioPackets-baseline.packets,playbackDrained:true,
        usageObservations:evidence.usageEvents.filter((usage:any)=>usage.turnEpoch===observedTool.epoch),
        measurement:'exact HTTP paint + same-epoch board tool completion + later PCM/listening + naturally ended AudioContext sources; not human audibility'});
      return current;
    };
    await finishPhase('initial-bfs',{sourceId:graph.id,algorithm:'bfs',stepIndex:0},'board.create',{packets:0,scheduled:0,since:Date.parse(report.startedAt)});
    report.checks.push('closed workspace opened for exact owned BFS graph; authenticated paint preceded board tool response and subsequent provider PCM');
    const ask=async(text:string)=>{
      const before=await page.evaluate(()=>{const e=(window as any).__dsaVoice;return{packets:e.audioPackets,scheduled:e.scheduledPackets,socketOpen:e.socketOpen,errors:e.errors,activeSources:e.activeSources};});
      expect(before.socketOpen).toBe(true);expect(before.errors).toEqual([]);expect(before.activeSources).toBe(0);
      const baseline={packets:before.packets,scheduled:before.scheduled,since:Date.now()};
      await page.evaluate(text=>(window as any).__dsaVoiceSocket.send(JSON.stringify({type:'text',text})),text);return baseline;
    };
    const nextBaseline=await ask('Next step, please. Explain just that displayed node and queue.');
    const step1=await finishPhase('next-bfs-step',{sourceId:graph.id,algorithm:'bfs',stepIndex:1},'board.patch',nextBaseline);
    const state=step1.result.steps[1],label=(id:string)=>step1.result.nodes.find((n:any)=>n.id===id)?.label??id;
    await expect(page.getByTestId('dsa-current')).toHaveText(label(state.currentId));
    await expect(page.getByTestId('dsa-frontier')).toHaveText(state.frontierIds.length?state.frontierIds.map(label).join(' · '):'Empty');
    report.checks.push('one learner next-step request produced exactly BFS step1 and matching visible current node/frontier');
    const dfsBaseline=await ask('Show DFS on the same undirected graph. Explain only the first displayed step, briefly.');
    await finishPhase('dfs-same-graph',{sourceId:graph.id,algorithm:'dfs',stepIndex:0},['board.patch','board.replace'],dfsBaseline);
    report.checks.push('learner DFS request preserved graph identity and source, resetting to step0');
    const treeBaseline=await ask('Show the binary tree using inorder traversal, at its first step. Explain it briefly.');
    const replaced=await finishPhase('inorder-replacement',{sourceId:tree.id,algorithm:'inorder',stepIndex:0},'board.replace',treeBaseline);expect(replaced.history.length).toBeGreaterThan(0);
    await expect(page.getByTestId('dsa-svg')).toBeVisible();
    await page.setViewportSize({width:360,height:780});
    const stop=page.getByRole('button',{name:'Stop voice',exact:true}).first();await expect(stop).toBeVisible();
    const bounds=await stop.boundingBox();expect(bounds).toBeTruthy();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(361);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(781);
    await stop.click();await expect.poll(()=>page.evaluate(()=>(window as any).__dsaVoice.socketOpen),{timeout:3000}).toBe(false);
    await page.getByRole('button',{name:'Undo board change',exact:true}).click();
    await expect.poll(async()=>{const b=await board();return[b.id,b.sourceId,b.result.algorithm];},{timeout:3000}).toEqual([boardId,graph.id,'dfs']);
    report.checks.push('binary-tree replacement preserved board identity/history; mobile global Stop remained reachable and Undo restored the prior DFS graph');
    report.passed=true;
  }finally{
    await page.getByRole('button',{name:'Stop voice',exact:true}).first().click({timeout:1000}).catch(()=>{});
    await page.evaluate(async()=>{await Promise.all((window as any).__dsaUsageHashes??[]);}).catch(()=>{});
    report.browserEvidence=await page.evaluate(()=>(window as any).__dsaVoice??null).catch(()=>null);if(report.browserEvidence?.errors?.length)report.passed=false;
    if(report.passed&&(report.browserEvidence.usageEvents.length===0||report.browserEvidence.usageInvalidCount||report.browserEvidence.usageHashFailures))report.passed=false;
    report.usageObservationNote='Numeric provider usage events deduplicated by event ID, grouped by epoch/turn sequence with original modality counters and omissions. Periodic/cumulative events are not asserted to be distinct paid calls; no invoice reconciliation.';
    report.finishedAt=new Date().toISOString();report.measurement='Actual provider PCM and Chromium scheduling/paint proxies with synthetic silent mic; no human audibility, semantic teaching grade or invoice claim.';
    if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{origin:'http://localhost:3000'}}).then(r=>{report.courseCleanup=r.ok();}).catch(()=>{report.courseCleanup=false;});
    if(report.courseCleanup!==true)report.passed=false;
    await writeFile(file,JSON.stringify(history,null,2));
  }
  // Runtime errors discovered during shutdown and cleanup cannot become a
  // Playwright PASS with a failed JSON artifact. Earlier assertion errors retain
  // their original failure after finally has preserved the report.
  expect(report.browserEvidence?.errors??[]).toEqual([]);expect(report.courseCleanup).toBe(true);expect(report.passed).toBe(true);
});
