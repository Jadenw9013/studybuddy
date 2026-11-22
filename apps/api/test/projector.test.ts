import test from 'node:test';
import assert from 'node:assert/strict';
import { projectState, projectionId, type ProjectionClient } from '../src/projector.ts';
import { emptyState, type Source, type State } from '../src/store.ts';
import type {IllustrationJob} from '../src/illustration-types.ts';
import type {StudioArtifact} from '../src/studio.ts';

const owner = '10000000-0000-4000-8000-000000000001';
const course = '20000000-0000-4000-8000-000000000001';
const wrongCourse = '20000000-0000-4000-8000-000000000002';
const sourceId = '30000000-0000-4000-8000-000000000001';
const current = '40000000-0000-4000-8000-000000000002';
const earlier = '40000000-0000-4000-8000-000000000001';
const passage = '50000000-0000-4000-8000-000000000001';
const lessonId = '60000000-0000-4000-8000-000000000001';
const boardId = '70000000-0000-4000-8000-000000000001';
const practiceId = '80000000-0000-4000-8000-000000000001';
const attempt1 = '90000000-0000-4000-8000-000000000001';
const attempt2 = '90000000-0000-4000-8000-000000000002';
function fixture(): State {
  const s = emptyState();
  s.courses = [{ id: course, name: 'Original course' }, { id: wrongCourse, name: 'Another course' }];
  const old: Source = { id: sourceId, courseId: course, name: 'lecture.csv', versionId: earlier, revision: 1, hash: 'a'.repeat(64), status: 'ready',
    storageKey: `${owner}/${course}/${sourceId}/${earlier}`, skippedPages: [], passages: [{ id: passage, text: 'Exact older source wording', locator: { pageIndex: 1 } }] };
  s.sources = [{ ...old, versionId: current, revision: 2, storageKey: `${owner}/${course}/${sourceId}/${current}`, hash: 'b'.repeat(64), previous: [old],
    dataset: { columns: ['score'], numericColumns: ['score'], rows: [{ score: '1' }, { score: '2' }] } }];
  s.lessons = [{ id: lessonId, courseId: course, goal: 'Compare density', epoch: 2, quiet: false,
    board: { id: boardId, kind: 'histogram', revision: 1, sourceId, sourceVersionId: current, result: { counts: [2] }, history: [] },
    activeSource: { id: sourceId, versionId: earlier, passageId: passage },
    messages: [{ id: 'legacy-message-alias', role: 'tutor', text: 'A cited explanation.', citations: [{ sourceId, versionId: earlier, passageId: passage, locator: { pageIndex: 1 } }] }],
    receipts: { a1: { payload: JSON.stringify({ type: 'board.patch', turnEpoch: 2, expectedRevision: 0, args: { binCount: 1 } }),
      receipt: { status: 'saved', objectId: boardId, revision: 1, board: { hiddenSourceText: 'Do not duplicate raw source content into events' } } } },
    attempts: [{ id: attempt1, practiceId, skill: 'histogram', answer: 'First independent answer', independent: true, hintDepth: 0, result: { numeric: false }, at: '2026-11-16T08:00:00.000Z' },
      { id: attempt2, practiceId, skill: 'histogram', answer: 'Assisted retry', independent: false, hintDepth: 1, result: { numeric: true }, at: '2026-11-16T08:01:00.000Z' }],
  }];
  return s;
}
function recorder() {
  const calls: { sql: string; values: any[] }[] = [];
  const client: ProjectionClient = { query: async (sql, values = []) => { calls.push({ sql, values }); return { rows: [], rowCount: 0 }; } };
  const rows = (table: string) => calls.filter(call => call.sql.includes(`insert into public.${table} as target`)).flatMap(call => JSON.parse(call.values[1]));
  return { client, calls, rows };
}

test('domain projection keeps citation versions and first attempts while retaining assisted retries', async () => {
  const r = recorder(), s = fixture(); await projectState(r.client, owner, s);
  assert.equal(r.rows('source_versions').length, 2);
  assert.equal(r.rows('sources')[0].current_version_id, current);
  assert.equal(r.rows('message_citations')[0].version_id, earlier);
  assert.equal(r.rows('message_citations')[0].passage_id, passage);
  assert.deepEqual(r.rows('message_citations')[0].locator, { pageIndex: 1 });
  assert.equal(r.rows('lessons')[0].active_version_id, earlier);
  const attempts = r.rows('attempts');
  assert.deepEqual(attempts.map(row => [row.id, row.attempt_index, row.is_first, row.independent]), [[attempt1, 0, true, true], [attempt2, 1, false, false]]);
  assert.equal(attempts[0].first_response, 'First independent answer');
  assert.equal(attempts[0].item_variant, null);
  assert.equal(attempts[0].rubric_version, 'legacy-unversioned');
  assert.equal(r.calls.every(call => call.values[0] === owner), true);
  assert.equal(r.calls.some(call => /\b(begin|commit|set local role)\b/i.test(call.sql)), false);
});

test('projection never infers adult admission and refuses raw live transcript retention by default', async () => {
  const r = recorder(), s = fixture();
  s.lessons[0].messages.push({ id: 'voice:ephemeral', role: 'tutor', medium: 'voice', text: 'Private spoken transcript' });
  await projectState(r.client, owner, s);
  assert.equal(r.rows('profiles')[0].adult_confirmed_at, null);
  assert.deepEqual(r.rows('profiles')[0].retention_preferences, { liveTranscript: false, audio: false, screen: false });
  assert.equal(r.rows('messages').some(row => row.content === 'Private spoken transcript'), false);
  assert.equal(JSON.stringify(r.rows('action_events')).includes('hiddenSourceText'), false);
  assert.equal(JSON.stringify(r.rows('action_events')).includes('binCount'), false);
});

test('only terminal external notebook receipts become immutable action events', async () => {
  const s = fixture();
  s.lessons[0].receipts.pending = { payload: JSON.stringify({ fingerprint: 'hash', action: { type: 'notebook.propose', turnEpoch: 2, args: { replacement: 'private cell text' } } }), receipt: { external: true, status: 'previewed' } };
  let r = recorder(); await projectState(r.client, owner, s);
  assert.equal(r.rows('action_events').length, 1);
  s.lessons[0].receipts.pending.receipt = { external: true, status: 'applied', newHash: 'c'.repeat(64) };
  r = recorder(); await projectState(r.client, owner, s);
  assert.equal(r.rows('action_events').length, 2);
  assert.equal(r.rows('action_events')[1].operation, 'notebook.propose');
  assert.equal(JSON.stringify(r.rows('action_events')).includes('private cell text'), false);
});

test('cross-course board/citation identities reject the projection before commit', async () => {
  const s = fixture(); s.lessons[0].courseId = wrongCourse;
  await assert.rejects(projectState(recorder().client, owner, s), /different course/);
});

test('source tombstones remove all versions/datasets and queued jobs rather than republishing data', async () => {
  const s = fixture(); s.sources[0].deleted = true; s.sources[0].previous = [];
  s.lessons[0].messages = []; s.lessons[0].receipts = {}; delete s.lessons[0].activeSource; delete s.lessons[0].board;
  s.jobs = [{ id: 'a0000000-0000-4000-8000-000000000001', owner, courseId: course, sourceId, versionId: current, state: 'cancelled' }];
  const r = recorder(); await projectState(r.client, owner, s);
  assert.equal(r.rows('source_versions').length, 0);
  assert.equal(r.rows('datasets').length, 0);
  assert.equal(r.rows('ingest_jobs').length, 0);
  assert.equal(r.rows('sources')[0].current_version_id, null);
  assert.ok(r.rows('sources')[0].deleted_at);
  assert.ok(r.calls.some(call => call.sql.startsWith('delete from public.source_versions') && call.values[1].length === 0));
});

test('account erasure cascades the normalized profile and explicitly removes orphan legacy passages', async () => {
  const s = fixture(); s.deleted = true;
  const r = recorder(); await projectState(r.client, owner, s);
  assert.deepEqual(r.calls.map(call => call.sql), ['delete from public.retrieval_passages where owner_id=$1', 'delete from public.profiles where owner_id=$1']);
});

test('job leases/grants store only digests and known scopes; source paths stay private metadata', async () => {
  const s = fixture() as State & { grants: any[] };
  s.jobs = [{ id: 'a0000000-0000-4000-8000-000000000001', owner, courseId: course, sourceId, versionId: current, state: 'processing', leaseToken: 'private-worker-lease', leaseExpiresAt: 1_800_000_000_000, attempts: 1 }];
  s.grants = [{ id: 'b0000000-0000-4000-8000-000000000001', lessonId, nonceDigest: 'a'.repeat(64), scopes: ['notebook.propose', 'notebook.apply', 'shell'], expiresAt: 1_800_000_000_000, secret: 'private-pair-secret' }];
  const r = recorder(); await projectState(r.client, owner, s);
  assert.equal(JSON.stringify(r.rows('ingest_jobs')).includes('private-worker-lease'), false);
  assert.match(r.rows('ingest_jobs')[0].lease_token_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(r.rows('grants')[0].scopes, ['notebook.propose']);
  assert.equal(JSON.stringify(r.rows('grants')).includes('private-pair-secret'), false);
});

test('legacy message aliases map consistently without changing UUID identities', () => {
  assert.equal(projectionId(owner, 'message', lessonId), lessonId);
  assert.equal(projectionId(owner, 'message', 'alias'), projectionId(owner, 'message', 'alias'));
  assert.notEqual(projectionId(owner, 'message', 'alias'), projectionId(owner, 'other', 'alias'));
});

test('normalized entitlement reflects the paid purchase period and flags an expired pass inactive', async () => {
  const s = fixture(), now = Date.now();
  s.payments.paid = { fulfilled: true, startsAt: now - 1000, expiresAt: now + 28 * 86400_000 };
  let r = recorder(); await projectState(r.client, owner, s);
  assert.equal(r.rows('entitlements')[0].period_id, 'paid');
  assert.equal(r.rows('entitlements')[0].period_start, new Date(now - 1000).toISOString());
  assert.equal(r.rows('entitlements')[0].period_end, new Date(now + 28 * 86400_000).toISOString());
  assert.equal(r.rows('entitlements')[0].active, true);
  s.payments.paid.expiresAt = now - 1;
  r = recorder(); await projectState(r.client, owner, s);
  assert.equal(r.rows('entitlements')[0].active, false);
});

function illustration(overrides:Partial<IllustrationJob>={}):IllustrationJob{
  return {id:'c0000000-0000-4000-8000-000000000001',actionId:'illustration-action',fingerprint:'e'.repeat(64),turnEpoch:2,boardRevision:1,
    status:'ready',prompt:'Private illustration prompt',purpose:'Explain histogram area without adding numerical claims',title:'Area and frequency',
    model:'flux-2-klein-4b',fixture:false,createdAt:1_800_000_000_000,updatedAt:1_800_000_001_000,estimateUsd:.04,
    priceVersion:'synthetic-price-v1',costState:'estimated',passId:'pilot',providerId:'private-provider-job',
    storageKey:`${owner}/${course}/illustrations/${lessonId}/image.png`,mime:'image/png',submitted:true,...overrides};
}

test('optional illustration metadata stays private while BFL usage contains only estimates and no prompt/key',async()=>{
  const s=fixture();s.lessons[0].illustrations=[illustration()];const before=structuredClone(s.reservations);
  const r=recorder();await projectState(r.client,owner,s);
  const jobs=r.rows('illustrations');assert.equal(jobs.length,1);assert.equal(jobs[0].lesson_id,lessonId);
  assert.equal(jobs[0].prompt,'Private illustration prompt');assert.equal(jobs[0].storage_key,s.lessons[0].illustrations[0].storageKey);
  const usage=r.rows('usage').filter(row=>row.provider==='bfl');assert.equal(usage.length,1);
  assert.equal(usage[0].event_id,`illustration:${s.lessons[0].illustrations[0].id}`);assert.equal(usage[0].event_kind,'illustration_estimate');
  assert.equal(usage[0].estimated_usd,.04);assert.equal(usage[0].cost_unknown,false);assert.equal(usage[0].rate_version,'synthetic-price-v1');
  assert.equal(usage[0].token_categories,null);assert.equal(usage[0].duration_seconds,null);
  assert.equal(JSON.stringify(usage).includes('Private illustration prompt'),false);assert.equal(JSON.stringify(usage).includes('private-provider-job'),false);
  assert.equal(JSON.stringify(usage).includes('/illustrations/'),false);assert.deepEqual(s.reservations,before);
});

test('fixture/released/unsubmitted illustration jobs produce no BFL usage or phantom Google reservation',async()=>{
  for(const overrides of [{fixture:true},{costState:'released' as const,status:'cancelled' as const,submitted:false},{costState:'reserved' as const,status:'queued' as const,submitted:false}]){
    const s=fixture();s.lessons[0].illustrations=[illustration(overrides)];const r=recorder();await projectState(r.client,owner,s);
    assert.equal(r.rows('illustrations').length,1);assert.equal(r.rows('usage').filter(row=>row.provider==='bfl').length,0);
    assert.deepEqual(s.reservations,{});
  }
});

test('uncertain submitted illustration cost is unknown and Google settlement remains unchanged',async()=>{
  const s=fixture();s.lessons[0].illustrations=[illustration({costState:'unknown',status:'failed'})];
  s.reservations.voice={seconds:1200,settled:true,activeSeconds:10,lessonId,model:'gemini-live',estimatedUsd:.02,unknownCost:false} as any;
  const before=structuredClone(s.reservations),r=recorder();await projectState(r.client,owner,s);
  const bfl=r.rows('usage').find(row=>row.provider==='bfl');assert.equal(bfl.estimated_usd,null);assert.equal(bfl.cost_unknown,true);
  const google=r.rows('usage').find(row=>row.provider==='google'&&row.event_kind==='settlement');assert.equal(google.duration_seconds,10);assert.equal(google.estimated_usd,.02);
  assert.deepEqual(s.reservations,before);
});

test('removed or tombstoned illustration jobs prune metadata and never retain prompts in recap',async()=>{
  for(const remove of ['job','lesson','course']){
    const s=fixture();s.lessons[0].illustrations=[illustration()];
    if(remove==='job')s.lessons[0].illustrations=[];
    if(remove==='lesson')s.lessons[0].deleted=true;
    if(remove==='course')s.courses[0].deleted=true;
    const r=recorder();await projectState(r.client,owner,s);assert.equal(r.rows('illustrations').length,0);
    assert.ok(r.calls.some(call=>call.sql.startsWith('delete from public.illustrations')&&call.values[1].length===0));
    assert.equal(JSON.stringify(r.rows('lessons')).includes('Private illustration prompt'),false);
  }
});

test('illustration projection rejects cross-scope storage and nonfinite costs before commit',async()=>{
  for(const overrides of [{storageKey:`${owner}/${wrongCourse}/illustrations/${lessonId}/image.png`},{storageKey:`${owner}/${course}/illustrations/${lessonId}/../image.png`},{estimateUsd:NaN}]){
    const s=fixture();s.lessons[0].illustrations=[illustration(overrides)];
    await assert.rejects(projectState(recorder().client,owner,s),/different course/);
  }
});

test('source scope projection distinguishes legacy all from explicit none and preserves truthful dates and exact saved notes',async()=>{
  const s=fixture(),r=recorder(),l=s.lessons[0],createdAt='2026-11-21T08:00:00.000Z',updatedAt='2026-11-21T08:01:00.000Z',noteId='a9000000-0000-4000-8000-000000000001';
  l.selectedSourceIds=[];l.sourceSelectionRevision=2;l.sourceSelectionMessageOffset=1;
  l.notes=[{id:noteId,title:'My note',content:'My own saved explanation.',revision:2,createdAt,updatedAt,citations:[{sourceId,versionId:earlier,passageId:passage,locator:{pageIndex:1}}]}];
  await projectState(r.client,owner,s);const row=r.rows('lessons')[0];assert.equal(row.source_scope_mode,'selected');assert.equal(row.source_scope_revision,2);assert.equal(row.source_context_message_offset,1);assert.equal(row.created_at,null);assert.equal(r.rows('courses')[0].created_at,null);assert.equal(r.rows('lesson_selected_sources').length,0);
  const note=r.rows('saved_notes')[0];assert.equal(note.content,l.notes[0].content);assert.deepEqual(note.citations,l.notes[0].citations);assert.equal(note.created_at,createdAt);assert.equal(note.updated_at,updatedAt);
  l.selectedSourceIds=[sourceId];const selected=recorder();await projectState(selected.client,owner,s);assert.equal(selected.rows('lesson_selected_sources')[0].source_id,sourceId);
  delete l.selectedSourceIds;const all=recorder();await projectState(all.client,owner,s);assert.equal(all.rows('lessons')[0].source_scope_mode,'all');
});

test('note projection rejects different-course citation/selection identities, redacts tombstones and prunes explicit removals',async()=>{
  const s=fixture(),l=s.lessons[0],noteId='a9000000-0000-4000-8000-000000000002',createdAt='2026-11-21T08:00:00.000Z';
  l.notes=[{id:noteId,title:'Saved',content:'PRIVATE_NOTE',revision:1,createdAt,updatedAt:createdAt,citations:[]}];
  l.notes[0].citations=[{sourceId:'30000000-0000-4000-8000-000000000099',versionId:current,passageId:passage,locator:{}}];await assert.rejects(projectState(recorder().client,owner,s),/different course/);
  l.notes[0].citations=[];l.selectedSourceIds=['30000000-0000-4000-8000-000000000099'];await assert.rejects(projectState(recorder().client,owner,s),/different course/);
  l.selectedSourceIds=[];l.notes[0].deleted=true;const removed=recorder();await projectState(removed.client,owner,s);assert.equal(removed.rows('saved_notes')[0].content,'');assert.equal(removed.rows('saved_notes')[0].title,'');assert.deepEqual(removed.rows('saved_notes')[0].citations,[]);
  l.notes=[];const pruned=recorder();await projectState(pruned.client,owner,s);assert.ok(pruned.calls.some(call=>call.sql.startsWith('delete from public.saved_notes')&&call.values[1].length===0));
});

function studioArtifact():StudioArtifact{
 const createdAt='2026-11-21T08:00:00.000Z';return{id:'a8000000-0000-4000-8000-000000000001',kind:'guide',status:'ready',title:'Saved guide',createdAt,updatedAt:createdAt,revision:2,fixture:true,requestFingerprint:'d'.repeat(64),epoch:2,selectionRevision:0,sourceVersions:[{sourceId,versionId:current,filename:'lecture.csv'}],coverage:{selectedSourceCount:1,usedSourceCount:1,passageCount:1},content:{sections:[{id:'section-one',heading:'Rule',text:'Supported study words.',citations:[{sourceId,versionId:current,filename:'lecture.csv',passageId:passage,text:'Exact older source wording',locator:{pageIndex:1}}]}]},progress:{cursor:0,knownCardIds:[],answers:{},updatedAt:createdAt}};
}
test('Studio projection persists normalized ready content, exact source-version joins and request digests across lesson removal',async()=>{
 const s=fixture(),artifact=studioArtifact();s.lessons[0].studio=[artifact];s.studioRequests={[artifact.id]:{lessonId,fingerprint:artifact.requestFingerprint}};
 const r=recorder();await projectState(r.client,owner,s);assert.equal(r.rows('studio_requests')[0].fingerprint,artifact.requestFingerprint);assert.deepEqual(r.rows('studio_artifacts')[0].content,artifact.content);assert.equal(r.rows('studio_artifact_sources')[0].version_id,current);assert.equal(r.rows('studio_artifacts')[0].source_version_count,1);
 s.lessons=[];const purged=recorder();await projectState(purged.client,owner,s);assert.equal(purged.rows('studio_requests').length,1);assert.equal(purged.rows('studio_artifacts').length,0);assert.ok(purged.calls.some(call=>call.sql.startsWith('delete from public.studio_artifacts')&&call.values[1].length===0));assert.equal(purged.calls.some(call=>call.sql.startsWith('delete from public.studio_requests')),false);
});
test('Studio projection handles lifecycle content honestly and rejects changed request/source/citation identities',async()=>{
 for(const status of ['generating','failed','deleted'] as const){const s=fixture(),artifact=studioArtifact();artifact.status=status;artifact.content=undefined;if(status==='deleted'){artifact.title='';artifact.sourceVersions=[];}s.lessons[0].studio=[artifact];const r=recorder();await projectState(r.client,owner,s);assert.equal(r.rows('studio_artifacts')[0].content,null);assert.equal(r.rows('studio_artifacts')[0].status,status);assert.equal(r.rows('studio_artifact_sources').length,status==='deleted'?0:1);}
 for(const mutate of [(s:State)=>{s.studioRequests={[s.lessons[0].studio![0].id]:{lessonId,fingerprint:'e'.repeat(64)}};},(s:State)=>{s.lessons[0].studio![0].sourceVersions[0].sourceId='30000000-0000-4000-8000-000000000099';},(s:State)=>{s.lessons[0].studio![0].content!.sections![0].citations[0].locator={pageIndex:99};}]){const s=fixture();s.lessons[0].studio=[studioArtifact()];mutate(s);await assert.rejects(projectState(recorder().client,owner,s),/different course/);}
});
