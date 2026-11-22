/** Real paid BFL through Chromium + actual local Supabase. No mock provider/route. */
import 'dotenv/config';
import {test,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {buildServer} from '../../apps/api/src/server.ts';
import {loadConfig} from '../../apps/api/src/config.ts';

let server:Awaited<ReturnType<typeof buildServer>>|undefined;
let worker:ReturnType<typeof spawn>|undefined;
let admin:ReturnType<typeof createClient>,local:any,owner='',email='',cookie='';
const report:any={kind:'real-bfl-real-local-services-browser',fixture:false,providerCalls:0,humanParticipants:0,checks:[],invoiceReconciled:false};
const reportPath='evals/results/illustration-browser.json';
let history:any={runs:[]};
const mark=(name:string)=>report.checks.push({name,passed:true});
async function waitFor<T>(read:()=>Promise<T|false>,label:string){for(let i=0;i<100;i++){const v=await read();if(v)return v;await new Promise(r=>setTimeout(r,200));}throw Error('Timed out: '+label);}

test.beforeAll(async()=>{
 await mkdir('evals/results',{recursive:true});await mkdir('.data',{recursive:true});
 try{history=JSON.parse(await readFile(reportPath,'utf8'));}catch{}
 if(history.runs?.length>=2)throw Error('Two-run paid browser probe cap reached. Review prior evidence before another generation.');
 if(!process.env.BFL_API_KEY)throw Error('A funded BFL key is required for this explicit paid suite.');
 local=JSON.parse((await readFile('.data/supabase-local-status.json','utf8')).replace(/^\uFEFF/,''));
 for(const name of ['API_URL','DB_URL','MAILPIT_URL'])if(!['localhost','127.0.0.1'].includes(new URL(local[name]).hostname))throw Error('This browser probe uses local Supabase only.');
 report.startedAt=new Date().toISOString();history.runs??=[];history.runs.push(report);await writeFile(reportPath,JSON.stringify(history,null,2));
 const config=loadConfig({APP_MODE:'live',NODE_ENV:'development',WEB_ORIGIN:'http://localhost:3000',DATABASE_URL:local.DB_URL,
  SUPABASE_URL:local.API_URL,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,
  WS_TICKET_SECRET:randomBytes(32).toString('hex'),INTERNAL_WORKER_SECRET:randomBytes(32).toString('hex'),
  PAID_CALLS_ENABLED:'true',ENABLE_ILLUSTRATIONS:'true',BFL_API_KEY:process.env.BFL_API_KEY,
  BFL_BASE_URL:process.env.BFL_BASE_URL??'https://api.bfl.ai',ILLUSTRATION_MODEL:process.env.ILLUSTRATION_MODEL??'flux-2-klein-9b',
  ILLUSTRATION_REQUEST_COST_USD:'0.015',ILLUSTRATION_PRICE_VERSION:'bfl-public-2026-11-19-768px',ILLUSTRATION_DAILY_LIMIT:'1'});
 server=await buildServer(config);await server.app.listen({host:'127.0.0.1',port:3001});
 worker=spawn(path.resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python'),['apps/worker/runner.py'],
  {windowsHide:true,stdio:'ignore',env:{...process.env,NODE_ENV:'development',API_INTERNAL_ORIGIN:'http://127.0.0.1:3001',INTERNAL_WORKER_SECRET:config.workerSecret,ENABLE_HYBRID:'false'}});
 admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 email=`bfl-browser-${randomUUID()}@example.test`;const created=await admin.auth.admin.createUser({email,email_confirm:true});
 if(created.error||!created.data.user)throw Error('Could not provision synthetic local invited account.');owner=created.data.user.id;
 report.model=config.illustrations.model;report.estimatedUsd=config.illustrations.priceUsd;
});

test('real BFL: learner generation displays privately, survives reload, and revokes on removal',async({page,browser})=>{
 report.browser=browser.version();report.platform=process.platform;
 page.on('request',request=>{if(/^https?:\/\//.test(request.url())&&!['localhost','127.0.0.1'].includes(new URL(request.url()).hostname))report.unexpectedBrowserNetwork=true;});
 await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('I am 18').check();await page.getByLabel('I understand private').check();
 await page.getByRole('button',{name:'Send a code'}).click();
 const mail:any=await waitFor(async()=>{const inbox=await(await fetch(local.MAILPIT_URL+'/api/v1/messages')).json();return inbox.messages?.find((m:any)=>m.To?.some((a:any)=>a.Address===email))??false;},'real local sign-in code');
 const detail=await(await fetch(local.MAILPIT_URL+'/api/v1/message/'+mail.ID)).json(),code=(detail.Text??detail.HTML??'').match(/\b\d{6}\b/)?.[0];
 if(!code)throw Error('No pasteable code in local email.');await page.getByLabel('One-time code').fill(code);await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Bring an assignment',exact:true})).toBeVisible();mark('real local emailed OTP sign-in in Chromium');
 cookie=(await page.context().cookies()).filter(c=>c.name==='tutor_session').map(c=>`${c.name}=${c.value}`).join(';');
 await page.getByRole('button',{name:'Bring an assignment',exact:true}).click();
 await page.getByLabel('Upload course files').setInputFiles(['fixtures/lecture.pdf','fixtures/attempt.ipynb','fixtures/scores.csv'].map(f=>path.resolve(f)));
 await expect(page.locator('#main').getByText('Ready · version 1',{exact:true})).toHaveCount(3,{timeout:30000});
 await page.getByRole('button',{name:'Open lesson',exact:true}).click();
 await page.getByText('Create a verified visual',{exact:true}).click();await page.getByRole('button',{name:'Create histogram',exact:true}).click();
 await expect(page.getByTestId('chart-summary')).toContainText('4 intervals');const before=await page.getByTestId('chart-summary').textContent();
 mark('ordinary private uploads and verified histogram before image request');
 const panel=page.getByRole('region',{name:'Optional illustrations'});await panel.locator('summary').click();
 await panel.getByLabel('Illustration title').fill('Sampling jars — live BFL');
 await panel.getByLabel('What should the image show?').fill('Two transparent jars with teal and amber wooden counters; a hand draws a small sample into a shallow tray. Clean editorial illustration, cream background. No text, equations, numeric labels or chart.');
 await panel.getByLabel('What should this help you understand?').fill('Picture random sampling from a population as a conceptual illustration.');
 const submitted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/actions')&&r.request().postDataJSON()?.type==='illustration.generate');
 const started=performance.now();await panel.getByRole('button',{name:/Generate illustration/}).click();
 const actionResponse=await submitted;expect(actionResponse.status()).toBe(200);const receipt=await actionResponse.json();report.providerCalls=1;
 const image=panel.getByRole('img',{name:'Sampling jars — live BFL'});await expect(image).toBeVisible({timeout:100000});
 await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth),{timeout:10000}).toBe(768);
 report.imageLoadProxyMs=Math.round(performance.now()-started);report.proxyDefinition='Generate click to Chromium naturalWidth=768; not speech-to-paint latency';
 await expect(panel.locator('figcaption')).toHaveText('AI-generated illustration');await expect(page.getByTestId('chart-summary')).toHaveText(before!);
 await page.screenshot({path:'evals/results/illustration-live-workspace.png',fullPage:true});mark('one actual BFL image rendered and labeled without changing verified chart');
 const contentPath=await image.getAttribute('src');expect(contentPath).toMatch(/^\/api\/lessons\/[^/]+\/illustrations\/[^/]+\/content$/);
 const fetched=await page.request.get(contentPath!);expect(fetched.status()).toBe(200);expect(fetched.headers()['cache-control']).toContain('no-store');
 await writeFile('.data/live-browser-illustration.png',await fetched.body());
 const lessonId=page.url().split('/lessons/')[1];
 const privateRow=await server!.store.pool!.query('select storage_key,fixture,status from public.illustrations where owner_id=$1 and id=$2',[owner,receipt.objectId]);
 expect(privateRow.rows[0].fixture).toBe(false);expect(privateRow.rows[0].status).toBe('ready');
 const anonymous=await fetch('http://127.0.0.1:3001'+contentPath!);expect(anonymous.status).toBe(401);
 const token=decodeURIComponent(cookie.split('=')[1]);const client=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 expect((await client.storage.from('course-originals').download(privateRow.rows[0].storage_key)).error).toBeTruthy();mark('real private Storage publication; API authentication and direct-browser Storage denial');
 await page.reload();const again=page.getByRole('region',{name:'Optional illustrations'}).getByRole('img',{name:'Sampling jars — live BFL'});
 await expect(again).toBeVisible();await expect.poll(()=>again.evaluate(n=>(n as HTMLImageElement).naturalWidth)).toBe(768);
 expect((await server!.store.pool!.query('select count(*)::int as n from public.illustrations where owner_id=$1 and lesson_id=$2',[owner,lessonId])).rows[0].n).toBe(1);
 expect((await server!.store.pool!.query("select count(*)::int as n from public.usage where owner_id=$1 and provider='bfl'",[owner])).rows[0].n).toBe(1);mark('reload restored actual image without a second generation or usage event');
 await page.getByRole('button',{name:'Remove illustration Sampling jars — live BFL'}).click();await expect(again).toHaveCount(0);
 expect((await page.request.get(contentPath!)).status()).toBe(404);expect((await admin.storage.from('course-originals').download(privateRow.rows[0].storage_key)).error).toBeTruthy();mark('removal revoked new reads and purged actual generated image bytes');
 expect(report.unexpectedBrowserNetwork).not.toBe(true);report.passed=true;
});

test.afterAll(async()=>{
 report.passed??=false;report.finishedAt=new Date().toISOString();report.checksPassed=report.checks.length;
 try{
  if(cookie&&server){const removed=await fetch('http://127.0.0.1:3001/api/account',{method:'DELETE',headers:{origin:'http://localhost:3000',cookie}});if(removed.status!==200)throw Error('Synthetic account cleanup did not finish.');}
 }catch{report.passed=false;report.cleanupFailed=true;}
 finally{
  worker?.kill();await server?.app.close();if(owner)await admin.auth.admin.deleteUser(owner);
  await writeFile(reportPath,JSON.stringify(history,null,2));
  console.log(JSON.stringify({...report,checks:report.checks.map((c:any)=>c.name)},null,2));
 }
 expect(report.cleanupFailed).not.toBe(true);
});
