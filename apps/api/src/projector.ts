import { createHash } from 'node:crypto';
import type { State, Source, Lesson } from './store.ts';
import { DomainError, canonical } from '../../../packages/contracts/index.ts';
import { paidPassPeriod } from './meter.ts';

export type ProjectionClient = { query(sql: string, values?: any[]): Promise<any> };
type Row = Record<string, unknown>;
type Column = readonly [string, string];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: unknown) => sha(canonical(value));
const integer = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const date = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new DomainError('projection_identity_invalid', `Invalid ${label} identity in confirmed state.`, 500);
  return value;
}
function scoped(condition: unknown): asserts condition {
  if (!condition) throw new DomainError('projection_scope_conflict', 'Confirmed data contains a different course or source identity.', 500);
}
/** Legacy client aliases map deterministically; existing UUIDs remain byte-identical. */
export function projectionId(owner: string, namespace: string, value: string) {
  if (uuid.test(value)) return value;
  const bytes = createHash('sha256').update(`${owner}\0${namespace}\0${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function put(client: ProjectionClient, owner: string, table: string, columns: readonly Column[], keys: string[], rows: Row[]) {
  if (!rows.length) return;
  // All identifiers/types below are first-party constants. Data stays parameterized.
  const fields = columns.map(([name]) => name);
  const mutable = fields.filter(name => !keys.includes(name));
  const assignments = mutable.map(name => `${name}=excluded.${name}`).join(',');
  const changed = mutable.map(name => `target.${name} is distinct from excluded.${name}`).join(' or ');
  const update = mutable.length ? `do update set ${assignments} where ${changed}` : 'do nothing';
  await client.query(`insert into public.${table} as target(owner_id,${fields.join(',')})
    select $1::uuid,${fields.map(name => `r.${name}`).join(',')} from jsonb_to_recordset($2::jsonb) as r(${columns.map(([name, type]) => `${name} ${type}`).join(',')})
    on conflict (${keys.join(',')}) ${update}`, [owner, JSON.stringify(rows)]);
}

async function prune(client: ProjectionClient, owner: string, table: string, column: string, keep: string[]) {
  await client.query(`delete from public.${table} where owner_id=$1 and not (${column}=any($2::uuid[]))`, [owner, keep]);
}

const profileColumns = [['adult_confirmed_at', 'timestamptz'], ['retention_preferences', 'jsonb']] as const;
const courseColumns = [['id', 'uuid'], ['title', 'text'], ['deleted_at', 'timestamptz'],['created_at','timestamptz'],['updated_at','timestamptz']] as const;
const sourceColumns = [['course_id', 'uuid'], ['id', 'uuid'], ['current_version_id', 'uuid'], ['deleted_at', 'timestamptz']] as const;
const versionColumns = [['course_id', 'uuid'], ['source_id', 'uuid'], ['id', 'uuid'], ['source_revision', 'integer'], ['content_hash', 'text'], ['mime_type', 'text'], ['original_name', 'text'], ['storage_key', 'text'], ['indexing_state', 'text'], ['failure_code', 'text'], ['skipped_pages', 'jsonb']] as const;
const lessonColumns = [['course_id', 'uuid'], ['id', 'uuid'], ['goal', 'text'], ['mode', 'text'], ['turn_epoch', 'bigint'], ['board_revision', 'bigint'], ['active_source_id', 'uuid'], ['active_version_id', 'uuid'], ['active_passage_id', 'uuid'], ['recap', 'jsonb'], ['last_activity_at', 'timestamptz'], ['deleted_at', 'timestamptz'],['created_at','timestamptz'],['updated_at','timestamptz'],['source_scope_mode','text'],['source_scope_revision','bigint'],['source_context_message_offset','integer']] as const;
const messageColumns = [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['id', 'uuid'], ['client_message_id', 'text'], ['role', 'text'], ['content', 'text'], ['status', 'text'], ['medium', 'text'], ['played', 'text'], ['created_at', 'timestamptz']] as const;
const boardColumns = [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['id', 'uuid'], ['kind', 'text'], ['revision', 'bigint'], ['source_id', 'uuid'], ['version_id', 'uuid'], ['props', 'jsonb']] as const;
const illustrationColumns = [['course_id','uuid'],['lesson_id','uuid'],['id','uuid'],['action_id','text'],['fingerprint','text'],['turn_epoch','bigint'],['board_revision','bigint'],['status','text'],['prompt','text'],['purpose','text'],['title','text'],['model','text'],['fixture','boolean'],['created_at','timestamptz'],['updated_at','timestamptz'],['estimate_usd','numeric'],['price_version','text'],['cost_state','text'],['pass_id','text'],['provider_id','text'],['storage_key','text'],['mime','text'],['message','text'],['submitted','boolean']] as const;

/** Call after the owner aggregate row is locked and mutated, before the SAME COMMIT.
 * No provider/storage/network calls, role changes, transaction boundaries or secrets.
 */
export async function projectState(client: ProjectionClient, ownerId: string, state: State) {
  id(ownerId, 'owner');
  if (state.deleted) {
    await client.query('delete from public.retrieval_passages where owner_id=$1', [ownerId]);
    await client.query('delete from public.profiles where owner_id=$1', [ownerId]);
    return;
  }
  const extended = state as State & { profile?: { adultConfirmedAt?: string; retention?: { liveTranscript?: boolean } }; grants?: any[] };
  await put(client, ownerId, 'profiles', profileColumns, ['owner_id'], [{
    adult_confirmed_at: date(extended.profile?.adultConfirmedAt),
    retention_preferences: { liveTranscript: extended.profile?.retention?.liveTranscript === true, audio: false, screen: false },
  }]);
  const studioRequests={...(state.studioRequests??{})};
  for(const l of state.lessons)for(const artifact of l.studio??[]){const prior=studioRequests[artifact.id];if(prior)scoped(prior.lessonId===l.id&&prior.fingerprint===artifact.requestFingerprint);else studioRequests[artifact.id]={lessonId:l.id,fingerprint:artifact.requestFingerprint};}
  const requestRows=Object.entries(studioRequests).map(([requestId,request])=>{scoped(/^[a-f0-9]{64}$/.test(request.fingerprint));return{id:id(requestId,'studio request'),lesson_id:id(request.lessonId,'studio request lesson'),fingerprint:request.fingerprint};});
  await put(client,ownerId,'studio_requests',[['id','uuid'],['lesson_id','uuid'],['fingerprint','text']],['owner_id','id'],requestRows);
  const deletedAt = new Date().toISOString();
  const courses = state.courses ?? [];
  const courseMap = new Map(courses.map(course => [id(course.id, 'course'), course]));
  const sourceRows: Row[] = [], versions: Row[] = [], datasets: Row[] = [];
  const versionMap = new Map<string, { courseId: string; sourceId: string; source: Source }>();
  const sourceMap = new Map<string, Source>();
  await put(client, ownerId, 'courses', courseColumns, ['owner_id', 'id'], courses.map(course => ({
    id: course.id, title: course.deleted ? '[deleted]' : course.name, deleted_at: course.deleted ? deletedAt : null,created_at:date(course.createdAt),updated_at:date(course.updatedAt),
  })));
  for (const source of state.sources ?? []) {
    const sourceId = id(source.id, 'source'), courseId = id(source.courseId, 'course');
    scoped(courseMap.has(courseId));
    scoped(!sourceMap.has(sourceId)); sourceMap.set(sourceId, source);
    const removed = source.deleted || courseMap.get(courseId)!.deleted;
    sourceRows.push({ course_id: courseId, id: sourceId, current_version_id: removed ? null : id(source.versionId, 'source version'), deleted_at: removed ? deletedAt : null });
    if (removed) continue;
    for (const version of [source, ...(source.previous ?? [])]) {
      const versionId = id(version.versionId, 'source version');
      scoped(version.id === sourceId && version.courseId === courseId);
      if (versionMap.has(versionId)) { scoped(versionMap.get(versionId)!.sourceId === sourceId); continue; }
      versionMap.set(versionId, { courseId, sourceId, source: version });
      scoped(/^[a-f0-9]{64}$/.test(version.hash));
      versions.push({ course_id: courseId, source_id: sourceId, id: versionId, source_revision: Math.max(1, integer(version.revision, 1)), content_hash: version.hash,
        mime_type: mime(version.name), original_name: version.name, storage_key: version.storageKey, indexing_state: version.status,
        failure_code: version.status === 'needs_attention' ? 'ingestion_failed' : null, skipped_pages: version.skippedPages ?? [] });
      if (version.dataset) {
        const data = version.dataset as typeof version.dataset & { fingerprint?: string; units?: Record<string, unknown>; missing?: Record<string, number>; invalid?: Record<string, number> };
        datasets.push({ course_id: courseId, source_id: sourceId, version_id: versionId,
          typed_columns: data.columns.map(name => ({ name, type: data.numericColumns.includes(name) ? 'number_candidate' : 'text', unitsConfirmed: Boolean(data.units?.[name]) })),
          units: data.units ?? {}, row_count: data.rows.length,
          missing_count: sumCounts(data.missing), invalid_count: sumCounts(data.invalid),
          fingerprint: data.fingerprint && /^[a-f0-9]{64}$/.test(data.fingerprint) ? data.fingerprint : version.hash,
          normalization_backend: 'learner_state', normalized_data_key: `learner-state:${ownerId}:${sourceId}:${versionId}:dataset` });
      }
    }
  }
  await put(client, ownerId, 'sources', sourceColumns, ['owner_id', 'course_id', 'id'], sourceRows);
  await put(client, ownerId, 'source_versions', versionColumns, ['owner_id', 'course_id', 'source_id', 'id'], versions);
  await put(client, ownerId, 'datasets', [['course_id', 'uuid'], ['source_id', 'uuid'], ['version_id', 'uuid'], ['typed_columns', 'jsonb'], ['units', 'jsonb'], ['row_count', 'integer'], ['missing_count', 'integer'], ['invalid_count', 'integer'], ['fingerprint', 'text'], ['normalization_backend', 'text'], ['normalized_data_key', 'text']], ['owner_id', 'version_id'], datasets);

  const jobs: Row[] = [];
  for (const job of state.jobs ?? []) {
    const version = versionMap.get(job.versionId);
    if (!version) continue; // Tombstoned versions cannot republish jobs.
    scoped(job.courseId === version.courseId && job.sourceId === version.sourceId && (!job.owner || job.owner === ownerId));
    jobs.push({ id: id(job.id, 'job'), course_id: version.courseId, source_id: version.sourceId, version_id: job.versionId,
      parser_revision: job.parserRevision ?? 'r2-parser-1', state: job.state, lease_expires_at: date(job.leaseExpiresAt),
      lease_token_digest: typeof job.leaseToken === 'string' ? sha(job.leaseToken) : null,
      retry_count: integer(job.attempts), failure_code: job.state === 'failed' ? 'ingestion_failed' : null });
  }
  await put(client, ownerId, 'ingest_jobs', [['course_id', 'uuid'], ['source_id', 'uuid'], ['version_id', 'uuid'], ['id', 'uuid'], ['parser_revision', 'text'], ['state', 'text'], ['lease_expires_at', 'timestamptz'], ['lease_token_digest', 'text'], ['retry_count', 'integer'], ['failure_code', 'text']], ['owner_id', 'id'], jobs);

  const lessonMap = new Map<string, Lesson>();
  const lessonRows: Row[] = [], messages: Row[] = [], citations: Row[] = [], boards: Row[] = [], actions: Row[] = [], attempts: Row[] = [], illustrations: Row[] = [],selectedSources:Row[]=[],notes:Row[]=[],studioRows:Row[]=[],studioSources:Row[]=[];
  for (const lesson of state.lessons ?? []) {
    const lessonId = id(lesson.id, 'lesson'), courseId = id(lesson.courseId, 'lesson course');
    scoped(courseMap.has(courseId));
    lessonMap.set(lessonId, lesson);
    const removed = lesson.deleted || courseMap.get(courseId)!.deleted;
    const active = removed ? undefined : lesson.activeSource;
    if (active) scoped(versionMap.get(active.versionId)?.sourceId === active.id && versionMap.get(active.versionId)?.courseId === courseId);
    lessonRows.push({ course_id: courseId, id: lessonId, goal: removed ? '' : lesson.goal, mode: lesson.quiet ? 'quiet' : 'text',
      turn_epoch: integer(lesson.epoch), board_revision: removed ? 0 : integer(lesson.board?.revision),
      created_at:date(lesson.createdAt),updated_at:date(lesson.updatedAt),source_scope_mode:lesson.selectedSourceIds===undefined?'all':'selected',source_scope_revision:integer(lesson.sourceSelectionRevision),source_context_message_offset:integer(lesson.sourceSelectionMessageOffset),
      active_source_id: active?.id ?? null, active_version_id: active?.versionId ?? null, active_passage_id: active?.passageId ?? null,
      recap: removed ? {} : { attempts: (lesson.attempts ?? []).map(attempt => ({ id: attempt.id, skill: attempt.skill, independent: attempt.independent === true, result: attempt.result })) },
      last_activity_at: removed ? null : date((lesson as any).updatedAt ?? lesson.messages?.at(-1)?.at), deleted_at: removed ? deletedAt : null });
    if (removed) continue;
    for(const sourceId of lesson.selectedSourceIds??[]){const head=sourceMap.get(id(sourceId,'selected source'));scoped(head?.courseId===courseId);if(!head!.deleted)selectedSources.push({course_id:courseId,lesson_id:lessonId,source_id:sourceId});}
    for(const note of lesson.notes??[]){
      const createdAt=date(note.createdAt),updatedAt=date(note.updatedAt);scoped(Boolean(createdAt&&updatedAt&&updatedAt>=createdAt));
      scoped(Number.isSafeInteger(note.revision)&&note.revision>0&&note.citations.length<=25);
      for(const citation of note.citations){const head=sourceMap.get(citation.sourceId);scoped(head?.courseId===courseId);if(!head!.deleted)scoped(versionMap.get(citation.versionId)?.sourceId===head!.id&&versionMap.get(citation.versionId)?.courseId===courseId);}
      notes.push({course_id:courseId,lesson_id:lessonId,id:id(note.id,'note'),revision:note.revision,title:note.deleted?'':note.title,content:note.deleted?'':note.content,citations:note.deleted?[]:note.citations,from_message_id:note.deleted?null:note.fromMessageId??null,creation_fingerprint:note.creationFingerprint??digest({id:note.id,createdAt:note.createdAt}),created_at:createdAt,updated_at:updatedAt,deleted_at:note.deleted?updatedAt:null});
    }
    for(const artifact of lesson.studio??[]){
      const artifactId=id(artifact.id,'studio artifact'),createdAt=date(artifact.createdAt),updatedAt=date(artifact.updatedAt);
      scoped(Boolean(createdAt&&updatedAt&&updatedAt>=createdAt));scoped(Number.isSafeInteger(artifact.revision)&&artifact.revision>0);
      scoped(artifact.status==='deleted'?artifact.sourceVersions.length===0:artifact.sourceVersions.length>0);
      for(const ref of artifact.sourceVersions){const version=versionMap.get(ref.versionId);scoped(version?.sourceId===ref.sourceId&&version.courseId===courseId);studioSources.push({course_id:courseId,lesson_id:lessonId,artifact_id:artifactId,source_id:ref.sourceId,version_id:ref.versionId});}
      for(const item of [...(artifact.content?.sections??[]),...(artifact.content?.cards??[]),...(artifact.content?.questions??[])])for(const citation of item.citations){
        const version=versionMap.get(citation.versionId),passage=version?.source.passages.find(p=>p.id===citation.passageId);
        scoped(artifact.sourceVersions.some(ref=>ref.sourceId===citation.sourceId&&ref.versionId===citation.versionId)&&version?.courseId===courseId&&version.sourceId===citation.sourceId&&Boolean(passage)&&canonical(passage!.locator)===canonical(citation.locator));
      }
      studioRows.push({course_id:courseId,lesson_id:lessonId,id:artifactId,kind:artifact.kind,status:artifact.status,title:artifact.status==='deleted'?'':artifact.title,content:artifact.status==='ready'?artifact.content??null:null,progress:artifact.progress,coverage:artifact.coverage,error:artifact.error??null,source_version_count:artifact.sourceVersions.length,revision:artifact.revision,fixture:artifact.fixture,turn_epoch:integer(artifact.epoch),selection_revision:integer(artifact.selectionRevision),request_fingerprint:artifact.requestFingerprint,created_at:createdAt,updated_at:updatedAt});
    }
    for (const job of lesson.illustrations ?? []) {
      scoped(/^[a-f0-9]{64}$/.test(job.fingerprint));
      scoped(Number.isFinite(job.estimateUsd) && job.estimateUsd >= 0);
      const createdAt=date(job.createdAt),updatedAt=date(job.updatedAt);
      scoped(Boolean(createdAt && updatedAt && job.updatedAt >= job.createdAt));
      if(job.storageKey){
        scoped(job.storageKey.startsWith(`${ownerId}/${courseId}/illustrations/${lessonId}/`));
        scoped(!job.storageKey.split('/').some(part=>part==='.'||part==='..'));
      }
      illustrations.push({course_id:courseId,lesson_id:lessonId,id:id(job.id,'illustration'),action_id:job.actionId,
        fingerprint:job.fingerprint,turn_epoch:integer(job.turnEpoch),board_revision:integer(job.boardRevision),status:job.status,
        prompt:job.prompt,purpose:job.purpose,title:job.title,model:job.model,fixture:job.fixture,
        created_at:createdAt,updated_at:updatedAt,estimate_usd:job.estimateUsd,price_version:job.priceVersion,cost_state:job.costState,
        pass_id:job.passId,provider_id:job.providerId??null,storage_key:job.storageKey??null,mime:job.mime??null,message:job.message??null,submitted:job.submitted===true});
    }
    for (const message of lesson.messages ?? []) {
      if (!message.id || !['student', 'tutor'].includes(message.role)) continue;
      const medium = message.medium === 'voice' || message.channel === 'voice' || message.voice === true || String(message.id).startsWith('voice:') ? 'voice' : 'text';
      if (medium === 'voice' && extended.profile?.retention?.liveTranscript !== true) continue;
      const messageId = projectionId(ownerId, `message:${lessonId}`, String(message.id));
      messages.push({ course_id: courseId, lesson_id: lessonId, id: messageId, client_message_id: String(message.id), role: message.role,
        content: String(message.text ?? ''), status: String(message.status ?? 'complete'), medium,
        played: medium === 'voice' ? (message.played === 'confirmed' ? 'confirmed' : 'unknown') : null, created_at: date(message.at) });
      for (const [ordinal, citation] of (message.citations ?? []).entries()) {
        const version = versionMap.get(citation.versionId);
        scoped(version?.courseId === courseId && version.sourceId === citation.sourceId);
        citations.push({ course_id: courseId, lesson_id: lessonId, message_id: messageId, ordinal, source_id: citation.sourceId,
          version_id: citation.versionId, passage_id: id(citation.passageId, 'citation passage'), locator: citation.locator ?? {} });
      }
    }
    if (lesson.board) {
      const board = lesson.board;
      if (board.sourceId || board.sourceVersionId) scoped(versionMap.get(board.sourceVersionId!)?.sourceId === board.sourceId && versionMap.get(board.sourceVersionId!)?.courseId === courseId);
      const { history: _history, ...props } = board;
      boards.push({ course_id: courseId, lesson_id: lessonId, id: id(board.id, 'board'), kind: board.kind, revision: integer(board.revision), source_id: board.sourceId ?? null, version_id: board.sourceVersionId ?? null, props });
    }
    for (const [actionId, entry] of Object.entries(lesson.receipts ?? {})) {
      let payload: any = {};
      try { payload = JSON.parse(entry.payload); } catch { /* only its hash is retained */ }
      const receipt = entry.receipt ?? {};
      if (receipt.external && ['preview_requested', 'preview', 'previewed', 'checking_edit', 'pending'].includes(receipt.status)) continue;
      const intent = payload.action ?? payload;
      if (intent.type === "illustration.generate" && ["queued", "generating"].includes(receipt.status)) continue;
      const minimal: Row = {};
      for (const key of ['status', 'objectId', 'revision', 'sourceId', 'versionId', 'id', 'practiceId', 'skill', 'independent', 'skipped', 'newHash', 'baseHash']) {
        const value = receipt[key]; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') minimal[key] = value;
      }
      actions.push({ course_id: courseId, lesson_id: lessonId, action_id: actionId, request_id: actionId,
        operation: String(intent.type ?? 'unknown'), status: String(receipt.status ?? 'committed'), turn_epoch: integer(intent.turnEpoch),
        prior_revision: typeof intent.expectedRevision === 'number' ? integer(intent.expectedRevision) : null,
        new_revision: typeof receipt.revision === 'number' ? integer(receipt.revision) : null,
        payload_hash: lesson.illustrations?.find(job=>job.actionId===actionId)?.fingerprint ?? sha(entry.payload), receipt: minimal });
    }
    const attemptIndices = new Map<string, number>();
    for (const attempt of lesson.attempts ?? []) {
      const attemptIndex = attemptIndices.get(attempt.practiceId) ?? 0;
      attemptIndices.set(attempt.practiceId, attemptIndex + 1);
      attempts.push({ course_id: courseId, lesson_id: lessonId, id: id(attempt.id, 'attempt'), practice_id: id(attempt.practiceId, 'practice'), skill: String(attempt.skill),
        attempt_index: attemptIndex, is_first: attemptIndex === 0,
        item_variant: attempt.variantId ?? null,
        first_response: String(attempt.answer ?? ''), response_hash: digest({ answer: attempt.answer ?? '', practiceId: attempt.practiceId }),
        independent: attempt.independent === true && attemptIndex === 0, hint_depth: integer(attempt.hintDepth), skipped: attempt.skipped === true,
        outcome: attempt.result ?? {}, rubric_version: attempt.rubricVersion ?? 'legacy-unversioned', attempted_at: date(attempt.at) });
    }
  }
  await put(client, ownerId, 'lessons', lessonColumns, ['owner_id', 'course_id', 'id'], lessonRows);
  await put(client,ownerId,'lesson_selected_sources',[['course_id','uuid'],['lesson_id','uuid'],['source_id','uuid']],['owner_id','lesson_id','source_id'],selectedSources);
  await put(client,ownerId,'saved_notes',[['course_id','uuid'],['lesson_id','uuid'],['id','uuid'],['revision','bigint'],['title','text'],['content','text'],['citations','jsonb'],['from_message_id','text'],['creation_fingerprint','text'],['created_at','timestamptz'],['updated_at','timestamptz'],['deleted_at','timestamptz']],['owner_id','lesson_id','id'],notes);
  await put(client,ownerId,'studio_artifacts',[['course_id','uuid'],['lesson_id','uuid'],['id','uuid'],['kind','text'],['status','text'],['title','text'],['content','jsonb'],['progress','jsonb'],['coverage','jsonb'],['error','jsonb'],['source_version_count','integer'],['revision','bigint'],['fixture','boolean'],['turn_epoch','bigint'],['selection_revision','bigint'],['request_fingerprint','text'],['created_at','timestamptz'],['updated_at','timestamptz']],['owner_id','lesson_id','id'],studioRows);
  await put(client,ownerId,'studio_artifact_sources',[['course_id','uuid'],['lesson_id','uuid'],['artifact_id','uuid'],['source_id','uuid'],['version_id','uuid']],['owner_id','artifact_id','source_id','version_id'],studioSources);
  await put(client, ownerId, 'messages', messageColumns, ['owner_id', 'lesson_id', 'id'], messages);
  await put(client, ownerId, 'message_citations', [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['message_id', 'uuid'], ['ordinal', 'integer'], ['source_id', 'uuid'], ['version_id', 'uuid'], ['passage_id', 'uuid'], ['locator', 'jsonb']], ['owner_id', 'lesson_id', 'message_id', 'ordinal'], citations);
  await put(client, ownerId, 'board_objects', boardColumns, ['owner_id', 'lesson_id', 'id'], boards);
  await put(client, ownerId, 'illustrations', illustrationColumns, ['owner_id','lesson_id','id'], illustrations);
  await put(client, ownerId, 'action_events', [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['action_id', 'text'], ['request_id', 'text'], ['operation', 'text'], ['status', 'text'], ['turn_epoch', 'bigint'], ['prior_revision', 'bigint'], ['new_revision', 'bigint'], ['payload_hash', 'text'], ['receipt', 'jsonb']], ['owner_id', 'lesson_id', 'action_id'], actions);
  await put(client, ownerId, 'attempts', [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['id', 'uuid'], ['practice_id', 'uuid'], ['attempt_index', 'integer'], ['is_first', 'boolean'], ['skill', 'text'], ['item_variant', 'text'], ['first_response', 'text'], ['response_hash', 'text'], ['independent', 'boolean'], ['hint_depth', 'integer'], ['skipped', 'boolean'], ['outcome', 'jsonb'], ['rubric_version', 'text'], ['attempted_at', 'timestamptz']], ['owner_id', 'lesson_id', 'id'], attempts);

  const grants: Row[] = [];
  for (const grant of extended.grants ?? []) {
    const lesson = lessonMap.get(grant.lessonId);
    if (!lesson || lesson.deleted || courseMap.get(lesson.courseId)?.deleted) continue;
    scoped(/^[a-f0-9]{64}$/.test(grant.nonceDigest));
    grants.push({ course_id: lesson.courseId, lesson_id: lesson.id, id: id(grant.id, 'grant'), actor_id: ownerId, target_id: grant.targetId ?? null,
      scopes: (grant.scopes ?? []).filter((scope: unknown) => typeof scope === 'string' && /^notebook\.(focus|highlight|propose|undo)$/.test(scope)),
      expires_at: date(grant.expiresAt) ?? '1970-01-01T00:00:00.000Z', revoked_at: date(grant.revokedAt), nonce_digest: grant.nonceDigest });
  }
  await put(client, ownerId, 'grants', [['course_id', 'uuid'], ['lesson_id', 'uuid'], ['id', 'uuid'], ['actor_id', 'uuid'], ['target_id', 'text'], ['scopes', 'text[]'], ['expires_at', 'timestamptz'], ['revoked_at', 'timestamptz'], ['nonce_digest', 'text']], ['owner_id', 'id'], grants);
  await client.query('update public.grants set revoked_at=coalesce(revoked_at,now()) where owner_id=$1 and not(id=any($2::uuid[]))', [ownerId, grants.map(row => row.id)]);

  await projectMeter(client, ownerId, state, lessonMap);
  // Mutable snapshots mirror removals. Immutable attempts/action commits are kept
  // for active lessons and erased only by explicit lesson/course/account purge.
  await client.query('delete from public.messages where owner_id=$1 and not((lesson_id::text || chr(31) || id::text)=any($2::text[]))', [ownerId, messages.map(row => `${row.lesson_id}\x1f${row.id}`)]);
  await client.query('delete from public.message_citations where owner_id=$1 and not((lesson_id::text || chr(31) || message_id::text || chr(31) || ordinal::text)=any($2::text[]))', [ownerId, citations.map(row => `${row.lesson_id}\x1f${row.message_id}\x1f${row.ordinal}`)]);
  await prune(client, ownerId, 'board_objects', 'id', boards.map(row => String(row.id)));
  await client.query('delete from public.lesson_selected_sources where owner_id=$1 and not((lesson_id::text || chr(31) || source_id::text)=any($2::text[]))',[ownerId,selectedSources.map(row=>`${row.lesson_id}\x1f${row.source_id}`)]);
  await prune(client,ownerId,'saved_notes','id',notes.map(row=>String(row.id)));
  await client.query('delete from public.studio_artifact_sources where owner_id=$1 and not((artifact_id::text || chr(31) || source_id::text || chr(31) || version_id::text)=any($2::text[]))',[ownerId,studioSources.map(row=>`${row.artifact_id}\x1f${row.source_id}\x1f${row.version_id}`)]);
  await prune(client,ownerId,'studio_artifacts','id',studioRows.map(row=>String(row.id)));
  await prune(client, ownerId, 'illustrations', 'id', illustrations.map(row => String(row.id)));
  await prune(client, ownerId, 'ingest_jobs', 'id', jobs.map(row => String(row.id)));
  await prune(client, ownerId, 'datasets', 'version_id', datasets.map(row => String(row.version_id)));
  await prune(client, ownerId, 'lessons', 'id', lessonRows.filter(row => !row.deleted_at).map(row => String(row.id)));
  await prune(client, ownerId, 'source_versions', 'id', versions.map(row => String(row.id)));
  await prune(client, ownerId, 'sources', 'id', sourceRows.map(row => String(row.id)));
  await prune(client, ownerId, 'courses', 'id', courses.map(course => course.id));
}

function sumCounts(value?: Record<string, number>) { return value ? Object.values(value).reduce((sum, value) => sum + integer(value), 0) : 0; }
function mime(name: string) {
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.ipynb$/i.test(name)) return 'application/x-ipynb+json';
  if (/\.json$/i.test(name)) return 'application/json';
  return 'text/plain';
}

async function projectMeter(client: ProjectionClient, owner: string, state: State, lessons: Map<string, Lesson>) {
  const rows: Row[] = [];
  let consumed = 0, reserved = 0;
  const budgetPass = state.metering?.activePassId ?? 'pilot';
  const period = paidPassPeriod(state, Date.now());
  const activePass = period?.id ?? budgetPass;
  for (const [reservationId, reservation] of Object.entries(state.reservations ?? {})) {
    const meter = reservation as any;
    if (meter.entitlementId ? meter.entitlementId === activePass : !meter.passId || meter.passId === budgetPass) { if (meter.settled) consumed += integer(meter.activeSeconds); else reserved += integer(meter.seconds); }
    const lesson = lessons.get(meter.lessonId);
    const scope = lesson && !lesson.deleted && state.courses.some(course => course.id === lesson.courseId && !course.deleted)
      ? { course_id: lesson.courseId, lesson_id: lesson.id } : { course_id: null, lesson_id: null };
    const records = Object.values(meter.usageRecords ?? {}) as any[];
    for (const record of records) rows.push({ ...scope, event_id: String(record.eventId), reservation_id: reservationId, provider: 'google', model: meter.model ?? null,
      event_kind: 'provider_usage', duration_seconds: null, token_categories: record.units ?? null, estimated_usd: typeof record.usd === 'number' ? record.usd : null,
      rate_version: meter.pricing?.version ?? null, cost_unknown: record.usd === null || record.usd === undefined, close_reason: null });
    // Legacy observed counters are allowlisted; no raw SDK payload is persisted.
    if (!records.length) for (const [index, raw] of (meter.usage ?? []).entries()) {
      if (!raw || typeof raw !== 'object') continue;
      const tokens: Row = {};
      for (const key of ['promptTokenCount', 'responseTokenCount', 'totalTokenCount', 'cachedContentTokenCount']) if (typeof raw?.[key] === 'number') tokens[key] = integer(raw[key]);
      rows.push({ ...scope, event_id: raw.eventId ?? sha(`${reservationId}:${index}:${JSON.stringify(tokens)}`), reservation_id: reservationId, provider: 'google', model: meter.model ?? null,
        event_kind: 'provider_usage', duration_seconds: null, token_categories: tokens, estimated_usd: null, rate_version: null, cost_unknown: true, close_reason: null });
    }
    if (meter.settled) rows.push({ ...scope, event_id: `settlement:${reservationId}`, reservation_id: reservationId, provider: 'google', model: meter.model ?? null,
      event_kind: 'settlement', duration_seconds: integer(meter.activeSeconds), token_categories: null,
      estimated_usd: meter.unknownCost || typeof meter.estimatedUsd !== 'number' ? null : meter.estimatedUsd,
      rate_version: meter.pricing?.version ?? null, cost_unknown: meter.unknownCost === true || typeof meter.estimatedUsd !== 'number',
      close_reason: meter.reconciled ? 'abandoned_reconciled' : /^[a-z_]{1,64}$/.test(meter.closeReason ?? '') ? meter.closeReason : 'settled' });
  }
  for(const lesson of lessons.values()){
    if(lesson.deleted||!state.courses.some(course=>course.id===lesson.courseId&&!course.deleted))continue;
    for(const job of lesson.illustrations??[]){
      if(job.fixture||job.costState==='released'||job.costState==='reserved'&&job.submitted!==true)continue;
      const estimated=job.costState==='estimated';
      rows.push({course_id:lesson.courseId,lesson_id:lesson.id,event_id:`illustration:${job.id}`,reservation_id:`illustration:${job.id}`,
        provider:'bfl',model:job.model,event_kind:'illustration_estimate',duration_seconds:null,token_categories:null,
        estimated_usd:estimated?job.estimateUsd:null,rate_version:job.priceVersion,cost_unknown:!estimated,close_reason:job.costState});
    }
  }
  const remaining = integer(state.remainingSeconds), pass = state.metering?.passes[budgetPass];
  await client.query('update public.entitlements set active=false where owner_id=$1 and period_id<>$2', [owner, activePass]);
  await put(client, owner, 'entitlements', [['id', 'uuid'], ['period_id', 'text'], ['period_start', 'timestamptz'], ['period_end', 'timestamptz'], ['active', 'boolean'], ['allowance_seconds', 'integer'], ['remaining_seconds', 'integer'], ['consumed_seconds', 'integer'], ['reserved_seconds', 'integer'], ['estimated_provider_usd', 'numeric'], ['cost_unknown', 'boolean']], ['owner_id', 'id'], [{
    id: projectionId(owner, 'entitlement', activePass), period_id: activePass, period_start: date(period?.startsAt), period_end: date(period?.expiresAt), active: period?.active ?? true,
    allowance_seconds: remaining + consumed + reserved, remaining_seconds: remaining, consumed_seconds: consumed, reserved_seconds: reserved,
    estimated_provider_usd: pass && !pass.unknownCost ? pass.spentUsd : null, cost_unknown: !pass || pass.unknownCost,
  }]);
  await put(client, owner, 'usage', [['event_id', 'text'], ['reservation_id', 'text'], ['course_id', 'uuid'], ['lesson_id', 'uuid'], ['provider', 'text'], ['model', 'text'], ['event_kind', 'text'], ['duration_seconds', 'numeric'], ['token_categories', 'jsonb'], ['estimated_usd', 'numeric'], ['rate_version', 'text'], ['cost_unknown', 'boolean'], ['close_reason', 'text']], ['owner_id', 'event_id'], rows);
}
