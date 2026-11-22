/** Actual Fastify service + actual JupyterLab editor; synthetic automated approval. */
import { chromium, request } from '@playwright/test';
import { writeFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildServer } from '../../../apps/api/src/server.ts';
import { loadConfig } from '../../../apps/api/src/config.ts';

const jupyterURL = process.env.JUPYTER_TEST_URL || 'http://127.0.0.1:8891/lab?token=live-tutor-synthetic-host';
const apiPort = Number(process.env.COMPANION_API_PORT || 3011);
const {app} = await buildServer(loadConfig({APP_MODE:'fixture',WEB_ORIGIN:'http://localhost:3000',API_PORT:String(apiPort),DATA_DIR:await mkdtemp(path.join(tmpdir(),'tutor-companion-host-'))}));
await app.listen({host:'127.0.0.1',port:apiPort});
const client=await request.newContext({baseURL:`http://127.0.0.1:${apiPort}`,extraHTTPHeaders:{origin:'http://localhost:3000'}});
const verified=await client.post('/api/auth/verify',{data:{email:'companion-host@example.test',code:'246810',adult:true,consent:true}});assert.ok(verified.ok());
const course=await(await client.post('/api/courses',{data:{name:'Synthetic actual-notebook check'}})).json();
const lesson=await(await client.post('/api/lessons',{data:{courseId:course.id}})).json();
const pair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
// Inject only a transport failure. The real plugin still computes, previews,
// applies, persists its receipt and updates the actual Jupyter shared model.
await page.addInitScript(()=>{
  const NativeWebSocket=window.WebSocket;
  window.WebSocket=class extends NativeWebSocket {
    send(data) {
      if(new URL(this.url).pathname==='/companion'&&typeof data==='string') {
        let event;try{event=JSON.parse(data);}catch{}
        if(event?.type==='receipt'&&event.receipt?.status==='applied'&&event.receipt.actionId===window.__dropCompanionReceiptFor) {
          window.__lostReceiptSuppressed=true;window.__dropCompanionReceiptFor=null;
          this.close(4001,'synthetic disconnect after host write');return;
        }
      }
      super.send(data);
    }
  };
});
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
let lastSnapshot;
const waitFor=async(fn,label)=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+label);};
const refresh=async()=>{const result=await(await client.get(`/api/lessons/${lesson.id}/companion`)).json();lastSnapshot=result.snapshot;return result;};
const command=async(actionId,type,args)=>{const result=await client.post(`/api/lessons/${lesson.id}/companion/actions`,{data:{actionId,type,turnEpoch:0,args}});assert.equal(result.status(),200,await result.text());return result.json();};
const receipt=async actionId=>(await client.get(`/api/lessons/${lesson.id}/companion/actions/${actionId}`)).json();
const edit=text=>page.evaluate(text=>{const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb');notebook.content.activeCell.model.sharedModel.setSource(text);},text);
const report={kind:'synthetic-real-host-and-service',humanApprovals:0,startedAt:new Date().toISOString(),jupyterURL:jupyterURL.replace(/token=[^&]+/,'token=<redacted>'),checks:[]};
try {
  await page.goto(jupyterURL);
  await page.waitForFunction(()=>Boolean(window.jupyterapp),{timeout:90000});
  report.version=await page.evaluate(()=>window.jupyterapp.version);assert.match(report.version,/^4\./);
  await page.waitForFunction(()=>window.jupyterapp?.commands.hasCommand('docmanager:open')&&window.jupyterapp?.commands.hasCommand('live-tutor:open'),{timeout:90000});
  await page.getByRole('button',{name:'No',exact:true}).click({timeout:3000}).catch(()=>{});
  await page.evaluate(async()=>{const app=window.jupyterapp;await app.started;await app.restored;const panel=await app.commands.execute('docmanager:open',{path:'companion-smoke.ipynb'});await panel.context.ready;await panel.revealed;panel.content.activeCellIndex=0;await app.commands.execute('live-tutor:open');});
  await page.getByLabel('Pairing URL from your lesson').fill(pair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'paired actual-service snapshot');
  const replayCode=await page.evaluate(url=>new Promise(resolve=>{const socket=new WebSocket(url);socket.onclose=event=>resolve(event.code);socket.onerror=()=>{};}),pair.url);
  assert.equal(replayCode,1008);report.checks.push({name:'actual service consumes the pairing secret once',passed:true});
  const initialCellId=lastSnapshot.cellId,otherCell=lastSnapshot.cells.find(cell=>cell.cellId!==initialCellId);
  assert.ok(otherCell,'the actual notebook must expose another scoped cell');
  assert.deepEqual(Object.keys(otherCell).sort(),['baseHash','cellId','cellIndex']);
  await command('host-navigate-other','notebook.focus',{cellId:otherCell.cellId});
  await waitFor(async()=>(await receipt('host-navigate-other')).status==='focused','cross-cell focus receipt');
  await waitFor(async()=>(await refresh()).snapshot?.cellId===otherCell.cellId,'cross-cell active snapshot');
  assert.equal(await page.evaluate(()=>[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb').content.activeCell.model.id),otherCell.cellId);
  await command('host-navigate-back','notebook.focus',{cellId:initialCellId});
  await waitFor(async()=>(await receipt('host-navigate-back')).status==='focused','return focus receipt');
  await waitFor(async()=>(await refresh()).snapshot?.cellId===initialCellId,'return active snapshot');
  report.checks.push({name:'bounded cell metadata permits navigation within only the paired notebook',passed:true});
  const unknownCell=await client.post(`/api/lessons/${lesson.id}/companion/actions`,{data:{actionId:'host-unknown-cell',type:'notebook.focus',turnEpoch:0,args:{cellId:'not-in-the-paired-notebook'}}});assert.equal(unknownCell.status(),409);
  assert.equal(await page.evaluate(()=>[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb').content.activeCell.model.id),initialCellId);
  report.checks.push({name:'actual service denies a cell outside the paired metadata list',passed:true});
  await command('host-focus','notebook.focus',{});
  await waitFor(async()=>(await receipt('host-focus')).status==='focused','focus receipt');
  assert.equal(await page.evaluate(()=>[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb').content.activeCell.model.id),lastSnapshot.cellId);
  report.checks.push({name:'service focus targets the actual paired cell',passed:true});
  await command('host-highlight','notebook.highlight',{start:0,end:6});
  await waitFor(async()=>(await receipt('host-highlight')).status==='highlighted','highlight receipt');
  const selection=await page.evaluate(()=>{const editor=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb').content.activeCell.editor;const range=editor.getSelection();return {start:editor.getOffsetAt(range.start),end:editor.getOffsetAt(range.end)};});
  assert.deepEqual(selection,{start:0,end:6});report.checks.push({name:'service highlight selects the exact host editor range',passed:true});
  const original=lastSnapshot.source,replacement=original+'\n# locally approved synthetic edit';
  await command('host-apply','notebook.propose',{replacement});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  await refresh();assert.equal(lastSnapshot.source,original);report.checks.push({name:'proposal preserves source before approval',passed:true});
  await page.getByRole('button',{name:'Apply edit',exact:true}).click();
  await waitFor(async()=>(await receipt('host-apply')).status==='applied','applied receipt');
  await waitFor(async()=>(await refresh()).snapshot?.source===replacement,'updated actual notebook snapshot');
  report.checks.push({name:'local Apply changes real shared model once',passed:true});
  assert.equal((await receipt('host-apply')).status,'applied');
  const replay=await command('host-apply','notebook.propose',{replacement});assert.equal(replay.status,'applied');
  report.checks.push({name:'service receipt resolves lost acknowledgement and dispatch retry',passed:true});
  await command('host-reject','notebook.propose',{replacement:replacement+'\n# must not be written'});
  await page.getByRole('button',{name:'Keep mine',exact:true}).click();
  await waitFor(async()=>(await receipt('host-reject')).status==='rejected','rejected receipt');
  await refresh();assert.equal(lastSnapshot.source,replacement);report.checks.push({name:'Keep mine leaves cell unchanged',passed:true});
  await command('host-stale','notebook.propose',{replacement:replacement+'\n# stale proposal'});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  await edit(replacement+'\n# student changed this');
  await page.getByRole('button',{name:'Apply edit',exact:true}).click().catch(()=>{});
  await waitFor(async()=>(await receipt('host-stale')).status==='target_changed','stale refusal');
  report.checks.push({name:'student edit invalidates pending proposal',passed:true});
  const firstUndo=await page.evaluate(()=>{const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb');return notebook.content.activeCell.model.sharedModel.undo();});assert.equal(firstUndo,true,'native cell undo must be available for student edit');
  await waitFor(async()=>(await refresh()).snapshot?.source===replacement,'native undo student edit');
  const secondUndo=await page.evaluate(()=>{const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb');return notebook.content.activeCell.model.sharedModel.undo();});assert.equal(secondUndo,true,'native cell undo must be available for approved edit');
  await waitFor(async()=>(await refresh()).snapshot?.source===original,'native undo approved edit');
  report.checks.push({name:'native notebook undo restores original',passed:true});
  await command('host-expired','notebook.propose',{replacement:original+'\n# this proposal must expire'});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  // Real service action leases are sixty seconds. Use elapsed wall time rather
  // than changing either host's clock or substituting an in-app simulation.
  await new Promise(resolve=>setTimeout(resolve,61000));
  await page.getByRole('button',{name:'Apply edit',exact:true}).click();
  await waitFor(async()=>(await receipt('host-expired')).status==='expired','expired approval refusal');
  await refresh();assert.equal(lastSnapshot.source,original);report.checks.push({name:'elapsed real approval lease refuses a local Apply',passed:true});
  await page.getByRole('button',{name:'Stop notebook sharing',exact:true}).click();
  await waitFor(async()=>!(await refresh()).paired,'Stop closes actual-service pair');
  report.checks.push({name:'Stop revokes local grant and closes connection',passed:true});
  const stopped=await client.post(`/api/lessons/${lesson.id}/companion/actions`,{data:{actionId:'host-after-stop',type:'notebook.propose',turnEpoch:0,args:{replacement:original+'\n# forbidden after Stop'}}});assert.equal(stopped.status(),409);
  report.checks.push({name:'actual service refuses new action after Stop',passed:true});
  const newPair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
  await page.getByLabel('Pairing URL from your lesson').fill(newPair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'fresh explicit pairing');
  await command('host-switch','notebook.propose',{replacement:original+'\n# forbidden after document switch'});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  await writeFile(new URL('./companion-other.ipynb',import.meta.url),await readFile(new URL('./companion-smoke.ipynb',import.meta.url)));
  await page.evaluate(async()=>{const panel=await window.jupyterapp.commands.execute('docmanager:open',{path:'companion-other.ipynb'});await panel.context.ready;await panel.revealed;});
  await waitFor(async()=>!(await refresh()).paired,'document switch revokes pair');
  assert.equal(await page.getByRole('button',{name:'Apply edit',exact:true}).count(),0);
  report.checks.push({name:'switching actual notebook revokes grant and pending diff',passed:true});
  const renamePair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
  await page.evaluate(async()=>{await window.jupyterapp.commands.execute('live-tutor:open');});
  await page.getByLabel('Pairing URL from your lesson').fill(renamePair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'pair notebook for rename');
  await command('host-rename','notebook.propose',{replacement:lastSnapshot.source+'\n# forbidden after rename'});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  const renamedPath=`companion-renamed-${Date.now()}.ipynb`;
  await page.evaluate(async name=>{const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-other.ipynb');await notebook.context.rename(name);},renamedPath);
  await waitFor(async()=>!(await refresh()).paired,'actual notebook rename revokes pair');
  assert.equal(await page.getByRole('button',{name:'Apply edit',exact:true}).count(),0);
  report.checks.push({name:'renaming actual notebook revokes grant and pending diff',passed:true});
  await page.evaluate(async name=>{const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path===name);await notebook.context.rename('companion-other.ipynb');const original=await window.jupyterapp.commands.execute('docmanager:open',{path:'companion-smoke.ipynb'});await original.context.ready;await original.context.save();await window.jupyterapp.commands.execute('live-tutor:open');},renamedPath);
  const reloadPair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
  await page.getByLabel('Pairing URL from your lesson').fill(reloadPair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'pair notebook before full host reload');
  await command('host-reload','notebook.propose',{replacement:lastSnapshot.source+'\n# forbidden after host reload'});
  await page.getByRole('button',{name:'Apply edit',exact:true}).waitFor();
  await page.reload();
  await page.waitForFunction(()=>window.jupyterapp?.commands.hasCommand('live-tutor:open'),{timeout:90000});
  await page.evaluate(async()=>{await window.jupyterapp.started;await window.jupyterapp.restored;await window.jupyterapp.commands.execute('live-tutor:open');});
  await waitFor(async()=>!(await refresh()).paired,'full host reload revokes grant');
  assert.equal(await page.getByRole('button',{name:'Apply edit',exact:true}).count(),0);
  report.checks.push({name:'full Jupyter host reload does not renew permission or pending edit',passed:true});
  await page.evaluate(async()=>{const notebook=await window.jupyterapp.commands.execute('docmanager:open',{path:'companion-smoke.ipynb'});await notebook.context.ready;await notebook.revealed;await window.jupyterapp.commands.execute('live-tutor:open');});
  const lostPair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
  await page.getByLabel('Pairing URL from your lesson').fill(lostPair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'explicit pairing after reload');
  const beforeLoss=lastSnapshot.source,afterLoss=beforeLoss+'\n# approved before transport acknowledgement was lost';
  await page.evaluate(()=>{window.__dropCompanionReceiptFor='host-lost-ack';window.__lostReceiptSuppressed=false;window.__hostSourceMutations=0;const notebook=[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb');notebook.content.activeCell.model.sharedModel.changed.connect((_,change)=>{if(change.sourceChange)window.__hostSourceMutations++;});});
  await command('host-lost-ack','notebook.propose',{replacement:afterLoss});
  await page.getByRole('button',{name:'Apply edit',exact:true}).click();
  await page.waitForFunction(()=>window.__lostReceiptSuppressed===true);
  await waitFor(async()=>!(await refresh()).paired,'forced loss after local source write');
  assert.equal(await page.evaluate(()=>[...window.jupyterapp.shell.widgets('main')].find(w=>w.context?.path==='companion-smoke.ipynb').content.activeCell.model.sharedModel.getSource()),afterLoss);
  assert.equal(await page.evaluate(()=>window.__hostSourceMutations),1);
  const recoveredPair=await(await client.post(`/api/lessons/${lesson.id}/pair`)).json();
  await page.getByLabel('Pairing URL from your lesson').fill(recoveredPair.url);
  await page.getByRole('button',{name:'Pair this notebook',exact:true}).click();
  await waitFor(async()=>Boolean((await refresh()).snapshot),'explicit pair after lost acknowledgement');
  await waitFor(async()=>(await receipt('host-lost-ack')).status==='applied','durable local receipt reconciliation after lost acknowledgement');
  const replayLoss=await command('host-lost-ack','notebook.propose',{replacement:afterLoss});
  assert.equal(replayLoss.status,'applied');
  assert.equal(await page.evaluate(()=>window.__hostSourceMutations),1);
  assert.equal(await page.getByRole('button',{name:'Apply edit',exact:true}).count(),0);
  report.checks.push({name:'lost acknowledgement reconciles durable local receipt after re-pair without a second write',passed:true});
  report.lostAckObservedSourceWrites=await page.evaluate(()=>window.__hostSourceMutations);
  await page.getByRole('button',{name:'Stop notebook sharing',exact:true}).click();
  report.passed=true;
} catch(error) {report.passed=false;report.failure=String(error);process.exitCode=1;}
finally {
  report.finishedAt=new Date().toISOString();report.pageErrors=errors;
  await mkdir(new URL('./output/',import.meta.url),{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('./output/real-host.png',import.meta.url)),fullPage:true}).catch(()=>{});
  await writeFile(new URL('./output/real-host.json',import.meta.url),JSON.stringify(report,null,2));
  await browser.close();await client.dispose();await app.close();console.log(JSON.stringify(report,null,2));
}

