/** Real-provider acceptance. Synthetic uploaded content only; never auto-retry. */
import 'dotenv/config';
import {test,expect,type Locator} from '@playwright/test';
import {mkdir,readFile,writeFile,open,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {loadConfig} from '../../apps/api/src/config.ts';
import {Store} from '../../apps/api/src/store.ts';
import type {Reservation} from '../../apps/api/src/meter.ts';
import type {StudioArtifact,StudioKind} from '../../apps/api/src/studio.ts';

const kinds:StudioKind[]=['guide','flashcards','quiz'];
const labels={guide:'Generate study guide',flashcards:'Generate flashcards',quiz:'Generate quiz'};
const historyFile='evals/live/results/notebook-studio.json';
const plain=(text:string,max=380)=>text.replace(/[`#*_<>]/g,'').replace(/[\u0000-\u001f]/g,' ').slice(0,max);
function numericUsage(metadata:any){
  const counters=['promptTokenCount','candidatesTokenCount','responseTokenCount','thoughtsTokenCount','totalTokenCount','cachedContentTokenCount'];
  const out:any=Object.fromEntries(counters.map(key=>[key,typeof metadata?.[key]==='number'&&Number.isFinite(metadata[key])?metadata[key]:null]));
  for(const key of['promptTokensDetails','candidatesTokensDetails','responseTokensDetails','cacheTokensDetails'])out[key]=Array.isArray(metadata?.[key])?metadata[key].filter((item:any)=>['TEXT','AUDIO','IMAGE'].includes(item.modality)&&Number.isSafeInteger(item.tokenCount)&&item.tokenCount>=0).map((item:any)=>({modality:item.modality,tokenCount:item.tokenCount})):null;
  return out;
}

test('real Studio generates three cited study tools and resumes durable card/quiz progress',async({page,browser})=>{
  if(process.env.RUN_PAID_NOTEBOOK_STUDIO!=='true')throw Error('Set RUN_PAID_NOTEBOOK_STUDIO=true only after reviewing this bounded paid test.');
  const config=loadConfig();
  if(config.mode!=='live'||!config.devAuthBypass||!config.devAuthUserId||!config.paid||!['localhost','127.0.0.1','[::1]'].includes(new URL(config.databaseUrl!).hostname))
    throw Error('This suite requires live mode, the configured local test profile, paid-call controls and a loopback database.');
  await mkdir(path.dirname(historyFile),{recursive:true});
  const lockFile=historyFile+'.lock',lock=await open(lockFile,'wx').catch(()=>{throw Error('Studio verification is already locked. Review any interrupted run before removing its lock.');});
  let history:any={version:1,runs:[]},report:any,store:Store|undefined,courseId='',lessonId='';
  const save=()=>writeFile(historyFile,JSON.stringify(history,null,2));
  const api=async(url:string,method='GET',data?:unknown)=>{const response=await page.request.fetch(url,{method,data,headers:{origin:'http://localhost:3000'}});expect(response.ok(),`${method} ${url} status ${response.status()}`).toBe(true);return response.json();};
  try{
    try{history=JSON.parse(await readFile(historyFile,'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw Error('Studio history is unreadable; do not reset paid-run history.');}
    if(history.version!==1||!Array.isArray(history.runs)||history.runs.length>=2)throw Error('Studio allows one initial run and one explicitly reviewed failed-kind retry, at most four total generations.');
    let selected=kinds;
    const retryKind=process.env.NOTEBOOK_STUDIO_REVIEWED_RETRY_KIND,reason=process.env.NOTEBOOK_STUDIO_REVIEWED_REASON?.trim();
    if(history.runs.length){
      if(!kinds.includes(retryKind as StudioKind)||!reason||reason.length>240||history.runs[0].kinds?.[retryKind!]?.passed!==false)
        throw Error('A retry requires one previously failed kind and a concrete root-reviewed failure reason.');
      selected=[retryKind as StudioKind];
    }else if(retryKind)throw Error('An initial Studio run cannot be labeled a reviewed retry.');
    report={kind:'real-provider-notebook-studio-browser',fixture:false,syntheticInput:true,humanParticipants:0,startedAt:new Date().toISOString(),browser:browser.version(),
      runNumber:history.runs.length+1,passed:false,selectedKinds:selected,reviewedRetry:history.runs.length===1,...(reason?{reviewedFailureReason:reason}:{}),
      maximumGenerationRequests:selected.length,generationRequests:0,blockedUnexpectedRequests:0,pageErrorCount:0,kinds:{},
      gates:{semanticQualityReview:'open: inspect the bounded synthetic item samples',independentHumanTeachingEvaluation:'open',invoiceReconciliation:'open'}};
    history.runs.push(report);await save();
    const publicConfig=await api('/api/config');expect(publicConfig.mode).toBe('live');expect(publicConfig.authentication).toBe('local_test');expect(publicConfig.textAvailable).toBe(true);
    store=new Store(config);store.pool!.options.connectionTimeoutMillis=5000;
    const readUsage=async(requestId:string)=>{
      const client=await store!.pool!.connect().catch(()=>{throw Error('Read-only usage audit could not connect.');});
      try{
        await client.query('BEGIN READ ONLY');await client.query('SET LOCAL ROLE tutor_api');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[config.devAuthUserId]);
        await client.query("SET LOCAL statement_timeout='5s'");
        const result=await client.query<{reservation:Reservation}>("select state->'reservations'->$2::text as reservation from public.learner_state where owner_id=$1",[config.devAuthUserId,`studio:${requestId}`]);
        await client.query('ROLLBACK');const reservation=result.rows[0]?.reservation;
        expect(reservation?.lessonId).toBe(lessonId);expect(reservation?.model).toBe(config.textModel);expect(reservation?.settled).toBe(true);expect(reservation?.unknownCost).not.toBe(true);
        expect(reservation?.estimatedUsd).toBeGreaterThan(0);const records=Object.values(reservation?.usageRecords??{});expect(records).toHaveLength(1);
        const usage=records[0].providerMetadata as any;expect(usage?.totalTokenCount).toBeGreaterThan(0);expect(usage?.promptTokenCount).toBeGreaterThan(0);expect(usage?.candidatesTokenCount??usage?.responseTokenCount).toBeGreaterThan(0);
        return{eventCount:records.length,usage:numericUsage(usage),estimatedUsd:reservation!.estimatedUsd,unknownCost:reservation!.unknownCost??false,invoice:false};
      }catch(error){await client.query('ROLLBACK').catch(()=>{});if(error instanceof Error&&error.name==='Error'&&!('matcherResult'in error))throw Error('Read-only usage verification failed; no database details logged.');throw error;}finally{client.release();}
    };
    const name=`Studio acceptance ${randomUUID().slice(0,8)}`,course=await api('/api/courses','POST',{name});courseId=course.id;
    const filename='05-study-guide.md',bytes=await readFile(path.resolve('fixtures/dsa',filename));
    const upload=await page.request.post(`/api/courses/${courseId}/uploads`,{headers:{origin:'http://localhost:3000'},multipart:{file:{name:filename,mimeType:'text/markdown',buffer:bytes}}});expect(upload.ok()).toBe(true);
    await expect.poll(async()=>{const value=await api(`/api/courses/${courseId}`);return value.sources.filter((s:any)=>s.status.startsWith('ready')).length;},{timeout:30_000}).toBe(1);
    const uploaded=(await api(`/api/courses/${courseId}`)).sources;expect(uploaded).toHaveLength(1);const source=uploaded[0];expect(source.name).toBe(filename);expect(source.passages.length).toBeGreaterThan(0);
    const lesson=await api('/api/lessons','POST',{courseId,goal:'Learn how BFS and DFS differ, and how tree traversal differs from independent practice.'});lessonId=lesson.id;
    const studioUrl=`/api/lessons/${lessonId}/studio`,scope=await api(`/api/lessons/${lessonId}/sources`);expect(scope.selectedSources).toEqual([source.id]);
    const requested:Partial<Record<StudioKind,number>>={};
    await page.route('**/api/lessons/*/studio',async route=>{
      const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
      let body:any;try{body=request.postDataJSON();}catch{}
      if(new URL(request.url()).pathname!==studioUrl||!selected.includes(body?.kind)||(requested[body?.kind as StudioKind]??0)>=1||report.generationRequests>=selected.length){report.blockedUnexpectedRequests++;await route.abort('blockedbyclient');return;}
      requested[body.kind as StudioKind]=(requested[body.kind as StudioKind]??0)+1;report.generationRequests++;report.kinds[body.kind].requestId=body.requestId;await save();await route.continue();
    });
    page.on('pageerror',()=>{report.pageErrorCount++;});
    await page.goto(`/lessons/${lessonId}`);await expect(page).toHaveURL(`/lessons/${lessonId}`);
    await expect(page.locator('.topbar').getByRole('button',{name:'Sources (1)',exact:true})).toBeVisible();
    const tools=page.getByRole('region',{name:'Study tools',exact:true});await expect(tools).toBeVisible();
    await tools.getByLabel('Focus (optional)',{exact:true}).fill('BFS queue versus DFS stack; use only the supplied guide. Keep the artifact concise: two or three sections/cards/questions.');
    const verifyCitations=(artifact:StudioArtifact)=>{
      expect(artifact.status).toBe('ready');expect(artifact.fixture).toBe(false);expect(artifact.kind).toBeTruthy();expect(artifact.coverage.selectedSourceCount).toBe(1);expect(artifact.coverage.usedSourceCount).toBe(1);
      expect(artifact.sourceVersions).toEqual([{sourceId:source.id,versionId:source.versionId,filename}]);
      const rows=artifact.content?.sections??artifact.content?.cards??artifact.content?.questions??[];expect(rows.length).toBeGreaterThan(0);
      let citationCount=0;for(const item of rows){expect(item.citations.length).toBeGreaterThan(0);for(const citation of item.citations){citationCount++;expect(citation.sourceId).toBe(source.id);expect(citation.versionId).toBe(source.versionId);expect(citation.filename).toBe(filename);
        const passage=source.passages.find((p:any)=>p.id===citation.passageId);expect(passage).toBeTruthy();expect(citation.locator).toEqual(passage.locator);expect(citation.text).toBe(passage.text.slice(0,1100));}}
      return{itemCount:rows.length,citationCount,ownedSourceMatch:true,currentVersionMatch:true,exactSuppliedPassageAndLocatorMatch:true};
    };
    const saved=()=>api(studioUrl).then(data=>data.artifacts as StudioArtifact[]);
    const selectSaved=async(artifact:StudioArtifact)=>{await tools.locator('.studio-artifact-item').filter({has:page.getByText(artifact.title,{exact:true})}).click();const reader=tools.getByRole('article',{name:artifact.title,exact:true});await expect(reader).toBeVisible();return reader;};
    const openCitation=async(reader:Locator)=>{
      await reader.locator('.studio-citations .citation').first().click();const dialog=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Return to problem',exact:true})});await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:filename,exact:true})).toBeVisible();await expect(dialog.locator('blockquote')).not.toBeEmpty();await dialog.getByRole('button',{name:'Return to problem',exact:true}).click();
    };
    for(const kind of selected){
      const entry:any=report.kinds[kind]={passed:false,attempted:false,phase:'generation'};await save();
      try{
        await expect(tools.getByRole('button',{name:labels[kind],exact:true})).toBeEnabled();
        const started=Date.now(),responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===studioUrl&&response.request().method()==='POST'&&response.request().postDataJSON()?.kind===kind,{timeout:55_000});void responsePromise.catch(()=>{});
        entry.attempted=true;await tools.getByRole('button',{name:labels[kind],exact:true}).click();const response=await responsePromise;entry.responseStatus=response.status();entry.firstResponseProxyMs=Date.now()-started;
        const data=await response.json();entry.responseCode=typeof data.code==='string'&&/^[a-zA-Z0-9_]{1,50}$/.test(data.code)?data.code:null;expect(response.ok(),`Studio ${kind} provider result ${response.status()} / ${data.code??'none'}`).toBe(true);const artifact=data.artifact as StudioArtifact;expect(artifact.kind).toBe(kind);expect(artifact.id).toBe(entry.requestId);
        entry.phase='citation_checks';entry.citations=verifyCitations(artifact);entry.phase='usage_audit';entry.provider=await readUsage(artifact.id);
        entry.phase='render';const reader=tools.getByRole('article',{name:artifact.title,exact:true});await expect(reader).toBeVisible();await expect(reader.locator('.studio-badge')).toHaveCount(0);
        entry.phase='topic_relevance';const text=(artifact.content?.sections??artifact.content?.cards??artifact.content?.questions??[]).map(item=>{const {citations,id,...content}=item;return JSON.stringify(content);}).join(' ');expect(text).toMatch(/\b(BFS|breadth.first|DFS|depth.first)\b/i);expect(text).toMatch(/\b(queue|stack)\b/i);
        if(kind==='guide'){
          entry.phase='guide_citation_dialog';
          await openCitation(reader);entry.samples=artifact.content!.sections!.slice(0,2).map(item=>({heading:plain(item.heading),text:plain(item.text)}));
        }else if(kind==='flashcards'){
          entry.phase='card_progress';
          const card=artifact.content!.cards![0];await reader.getByRole('button',{name:'Reveal answer',exact:true}).click();await expect(reader).toContainText(card.back.slice(0,60));await openCitation(reader);
          const progressResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`${studioUrl}/${artifact.id}/progress`&&r.request().method()==='PATCH');await reader.getByRole('button',{name:'Mark known',exact:true}).click();expect((await progressResponse).ok()).toBe(true);await expect(reader).toContainText('Known');
          const persisted=(await saved()).find(item=>item.id===artifact.id)!;expect(persisted.progress.knownCardIds).toEqual([card.id]);
          if(artifact.content!.cards!.length>1){const moved=page.waitForResponse(r=>new URL(r.url()).pathname===`${studioUrl}/${artifact.id}/progress`&&r.request().method()==='PATCH');await reader.getByRole('button',{name:'Next',exact:true}).click();expect((await moved).ok()).toBe(true);expect((await saved()).find(item=>item.id===artifact.id)!.progress.cursor).toBe(1);}
          const expectedProgress=(await saved()).find(item=>item.id===artifact.id)!.progress;
          await page.reload();await selectSaved(artifact);await expect(tools.getByRole('button',{name:labels.quiz,exact:true})).toBeEnabled();const reopened=(await saved()).find(item=>item.id===artifact.id)!;expect(reopened.progress).toEqual(expectedProgress);expect(reopened.progress.knownCardIds).toEqual([card.id]);expect(reopened.progress.cursor).toBe(artifact.content!.cards!.length>1?1:0);
          entry.samples=artifact.content!.cards!.slice(0,2).map(item=>({front:plain(item.front),back:plain(item.back)}));entry.knownCardPersisted=true;entry.cursorPersisted=true;
        }else{
          entry.phase='quiz_progress';
          const question=artifact.content!.questions![0];expect(question.options).toHaveLength(4);expect(new Set(question.options).size).toBe(4);expect(question.correctIndex).toBeGreaterThanOrEqual(0);expect(question.correctIndex).toBeLessThan(4);
          const answer=(question.correctIndex+1)%4,progressResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`${studioUrl}/${artifact.id}/progress`&&r.request().method()==='PATCH');await reader.locator('.studio-options button').nth(answer).click();expect((await progressResponse).ok()).toBe(true);await expect(reader.locator('.studio-feedback')).toContainText('Review this idea');await openCitation(reader);
          await page.reload();const reopenedReader=await selectSaved(artifact);await expect(reopenedReader.locator('.studio-feedback')).toContainText('Review this idea');await expect(reopenedReader.locator('.studio-options button').nth(answer)).toHaveAttribute('aria-pressed','true');expect((await saved()).find(item=>item.id===artifact.id)!.progress.answers[question.id]).toBe(answer);
          entry.samples=artifact.content!.questions!.slice(0,2).map(item=>({prompt:plain(item.prompt),options:item.options.map(option=>plain(option,180)),correctIndex:item.correctIndex,explanation:plain(item.explanation)}));entry.answerPersisted=true;
        }
        entry.phase='persisted_content';const persisted=(await saved()).find(item=>item.id===artifact.id)!;expect(persisted.content).toEqual(artifact.content);expect(verifyCitations(persisted)).toEqual(entry.citations);expect((await api(`/api/lessons/${lessonId}`)).lesson.attempts).toHaveLength(0);
        entry.persistedContent=true;entry.exactCitationDialogOpened=true;entry.passed=true;entry.phase='complete';
      }catch(error:any){entry.failure={phase:entry.phase,name:error?.name==='TimeoutError'?'TimeoutError':'verification_failed',code:typeof error?.code==='string'&&/^[a-zA-Z0-9_]{1,40}$/.test(error.code)?error.code:null};
        if(entry.requestId){try{entry.provider??=await readUsage(entry.requestId);}catch{entry.usageAuditPassed=false;}}}
      await save();
    }
    expect(report.generationRequests).toBe(selected.length);expect(report.blockedUnexpectedRequests).toBe(0);expect(report.pageErrorCount).toBe(0);
    report.passed=selected.every(kind=>report.kinds[kind]?.passed===true);
  }finally{
    if(report){
      report.finishedAt=new Date().toISOString();report.measurement='Real metered structured generations; response/UI timing proxies and numeric usage. Synthetic course only; no invoice or human teaching claim.';
      if(lessonId&&new URL(page.url()).pathname===`/lessons/${lessonId}`)await page.screenshot({path:`evals/live/results/notebook-studio-run-${report.runNumber}.png`,fullPage:true}).then(()=>{report.screenshotSaved=true;}).catch(()=>{report.screenshotSaved=false;});
      if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{origin:'http://localhost:3000'}}).then(r=>{report.courseCleanup=r.ok();}).catch(()=>{report.courseCleanup=false;});
      if(courseId&&report.courseCleanup!==true)report.passed=false;await save();
    }
    await store?.close();await lock.close();await unlink(lockFile);
  }
  expect(report?.courseCleanup).toBe(true);expect(report?.passed,'Inspect preserved per-kind history; do not automatically retry a failed paid generation.').toBe(true);
});
