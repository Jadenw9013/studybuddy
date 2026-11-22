import 'dotenv/config';
import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

test('one real text question creates owned DFS visual, paints it and opens an exact supplied citation',async({page,browser})=>{
  if(process.env.RUN_PAID_DSA_TEXT!=='true')throw Error('Set RUN_PAID_DSA_TEXT=true for this explicitly paid single-query suite.');
  const file='evals/live/results/dsa-text.json';let history:any={runs:[]};try{history=JSON.parse(await readFile(file,'utf8'));}catch{}
  if(history.runs.length>=2||(history.runs.length===1&&(process.env.DSA_TEXT_REVIEWED_RETRY!=='true'||history.runs[0].passed)))
    throw Error('One initial text run is allowed; one reviewed failed-run retry is capped at two total.');
  const report:any={kind:'real-provider-dsa-text-browser',fixture:false,syntheticInput:true,humanParticipants:0,browser:browser.version(),
    startedAt:new Date().toISOString(),passed:false,checks:[],reviewedRetry:history.runs.length===1,
    gates:{independentHumanTeachingEvaluation:'open',invoiceReconciliation:'open'},
    ...(history.runs.length===1?{reviewedFailureReason:history.runs[0].reviewedFailureReason}:{}),};
  history.runs.push(report);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(history,null,2));
  let courseId='',lessonId='';
  const api=async(url:string,method='GET',data?:unknown)=>{const response=await page.request.fetch(url,{method,data,headers:{origin:'http://localhost:3000'}});
    expect(response.ok(),`${method} ${url} returned ${response.status()}`).toBe(true);return response.json();};
  try{
    const config=await api('/api/config');expect(config.mode).toBe('live');expect(config.authentication).toBe('local_test');
    const course=await api('/api/courses','POST',{name:`DSA text ${randomUUID().slice(0,8)}`});courseId=course.id;
    const name='01-undirected-graph.json';const upload=await page.request.post(`/api/courses/${courseId}/uploads`,{headers:{origin:'http://localhost:3000'},
      multipart:{file:{name,mimeType:'application/json',buffer:await readFile(path.resolve('fixtures/dsa',name))}}});expect(upload.ok()).toBe(true);
    await expect.poll(async()=>{const data=await api(`/api/courses/${courseId}`);return data.sources.filter((s:any)=>s.status.startsWith('ready')).length;},{timeout:30_000}).toBe(1);
    const graph=(await api(`/api/courses/${courseId}`)).sources[0];expect(graph.dsa.kind).toBe('graph');expect(graph.dsa.directed).toBe(false);
    const lesson=await api('/api/lessons','POST',{courseId,goal:'Understand graph traversal'});lessonId=lesson.id;await page.goto(`/lessons/${lessonId}`);
    const close=page.getByRole('button',{name:'Close workspace',exact:true});if(await close.isVisible())await close.click();
    await expect(page.getByRole('complementary',{name:'Lesson workspace',exact:true})).toHaveCount(0);
    await page.getByLabel('Ask about your work',{exact:true}).fill('Explain DFS on this undirected graph, starting at A. Show what the stack and visited nodes mean at the first step, and cite the graph data you used.');
    const started=Date.now();
    const messagePromise=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/lessons/${lessonId}/messages`&&r.request().method()==='POST',{timeout:65_000});
    const paintPromise=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/lessons/${lessonId}/paint`&&r.request().method()==='POST',{timeout:65_000})
      .then(response=>{report.firstPaintAckProxyMs=Date.now()-started;return response;});void paintPromise.catch(()=>{});
    await page.getByRole('button',{name:'Ask',exact:true}).click();
    await page.evaluate(()=>{setTimeout(()=>{(document.querySelector('button[aria-label="Stop response"]') as HTMLButtonElement|null)?.click();},65_000);});
    const response=await messagePromise;expect(response.status()).toBe(200);await response.finished();
    const events=(await response.text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    report.streamEventTypes=events.map(event=>event.type);
    const errors=events.filter(event=>event.type==='error');report.errorCodes=errors.map(event=>event.code??'unclassified');expect(report.errorCodes).toEqual([]);
    expect(events.some(event=>event.type==='complete')).toBe(true);
    expect((await paintPromise).ok()).toBe(true);
    await expect(page.getByTestId('dsa-svg')).toBeVisible();
    const snapshot=await api(`/api/lessons/${lessonId}`),board=snapshot.lesson.board;
    expect(board.kind).toBe('dsa');expect(board.sourceId).toBe(graph.id);expect(board.sourceVersionId).toBe(graph.versionId);
    expect(board.result.algorithm).toBe('dfs');expect(board.result.stepIndex).toBe(0);expect(board.result.origin).toBe('Imported mock teaching dataset');
    expect(snapshot.lesson.paintedRevision).toBe(board.revision);
    const answer=snapshot.lesson.messages.filter((m:any)=>m.role==='tutor').at(-1);
    expect(answer).toBeTruthy();expect(answer.fixture).toBe(false);expect(Array.isArray(answer.providerCalls)).toBe(true);
    expect(answer.providerCalls.length).toBe(2);expect(new Set(answer.providerCalls.map((call:any)=>call.id)).size).toBe(2);
    for(const call of answer.providerCalls){expect(typeof call.id).toBe('string');expect(call.id.length).toBeGreaterThan(0);expect(call.usage?.totalTokenCount).toBeGreaterThan(0);}
    expect(answer.usage).toEqual(answer.providerCalls.at(-1).usage);
    expect(answer.usage?.totalTokenCount).toBeGreaterThan(0);expect(answer.receipt?.status).toBe('saved');
    expect(answer.receipt.objectId).toBe(board.id);expect(answer.receipt.revision).toBe(board.revision);
    expect(answer.citations.length).toBeGreaterThan(0);
    for(const citation of answer.citations){
      expect(citation.sourceId).toBe(graph.id);expect(citation.versionId).toBe(graph.versionId);expect(citation.locator.dsa).toBe(true);
      const passage=graph.passages.find((p:any)=>p.id===citation.passageId);expect(passage).toBeTruthy();expect(citation.text).toBe(passage.text);
    }
    const counters=['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount'];
    const numericUsage=(usage:any)=>Object.fromEntries(counters.map(key=>[key,typeof usage?.[key]==='number'&&Number.isFinite(usage[key])?usage[key]:null]));
    report.providerCalls=answer.providerCalls.length;report.perCallUsage=answer.providerCalls.map((call:any)=>numericUsage(call.usage));
    report.finalCallUsage=numericUsage(answer.usage);
    report.usage={scope:'sum of recorded counters across both calls; absent counters remain unknown',...Object.fromEntries(counters.map(key=>[
      key,report.perCallUsage.every((usage:any)=>usage[key]!==null)?report.perCallUsage.reduce((sum:number,usage:any)=>sum+usage[key],0):null,
    ]))};
    report.citations={count:answer.citations.length,ownedSourceMatch:true,currentVersionMatch:true,exactSuppliedPassageMatch:true};
    report.completedReplyProxyMs=Date.now()-started;
    await page.locator('.tutor-message').last().locator('button.citation').first().click();
    const dialog=page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Return to problem',exact:true})});
    await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(dialog.locator('blockquote')).not.toBeEmpty();await expect(dialog).toContainText('DSA');
    await dialog.getByRole('button',{name:'Return to problem',exact:true}).click();
    report.checks.push('ordinary private structured upload and actual ingestion','one natural question used two real metered propose/grounded calls',
      'typed owned-source DFS receipt, exact source version and actual Chromium paint','all citations matched supplied current passages; exact DSA source dialog opened');
    report.passed=true;
  }finally{
    await page.getByRole('button',{name:'Stop response',exact:true}).click({timeout:500}).catch(()=>{});
    report.finishedAt=new Date().toISOString();report.measurement='HTTP paint acknowledgement and completion timing proxies; real provider usage, no raw model output or invoice claim.';
    if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{origin:'http://localhost:3000'}}).then(r=>{report.courseCleanup=r.ok();}).catch(()=>{report.courseCleanup=false;});
    if(report.courseCleanup!==true)report.passed=false;await writeFile(file,JSON.stringify(history,null,2));
  }
  expect(report.courseCleanup).toBe(true);expect(report.passed).toBe(true);
});
