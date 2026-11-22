-- Revision 2 domain projections. The API updates these in the SAME transaction
-- as learner_state. Browser roles cannot edit admission, quotas, grants or tools.
create table public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  adult_confirmed_at timestamptz,
  retention_preferences jsonb not null default '{"liveTranscript":false,"audio":false,"screen":false}'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(retention_preferences) = 'object')
);

create table public.entitlements (
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  id uuid not null,
  period_id text not null,
  period_start timestamptz,
  period_end timestamptz,
  active boolean not null default true,
  allowance_seconds integer not null check (allowance_seconds >= 0),
  remaining_seconds integer not null check (remaining_seconds >= 0),
  consumed_seconds integer not null check (consumed_seconds >= 0),
  reserved_seconds integer not null check (reserved_seconds >= 0),
  estimated_provider_usd numeric(18,10),
  cost_unknown boolean not null default true,
  primary key (owner_id,id),
  unique (owner_id,period_id),
  check (period_end is null or period_start is null or period_end > period_start)
);
create unique index entitlements_one_active_idx on public.entitlements(owner_id) where active;

create table public.courses (
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  id uuid not null,
  title text not null check (length(title) between 1 and 200),
  deleted_at timestamptz,
  primary key (owner_id,id)
);

create table public.sources (
  owner_id uuid not null,
  course_id uuid not null,
  id uuid not null,
  current_version_id uuid,
  deleted_at timestamptz,
  primary key (owner_id,course_id,id),
  unique (owner_id,id),
  foreign key (owner_id,course_id) references public.courses(owner_id,id) on delete cascade
);
create index sources_current_version_idx on public.sources(owner_id,course_id,id,current_version_id);

create table public.source_versions (
  owner_id uuid not null,
  course_id uuid not null,
  source_id uuid not null,
  id uuid not null,
  source_revision integer not null default 1 check (source_revision > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null default 'application/octet-stream',
  original_name text not null default '',
  storage_key text not null,
  indexing_state text not null default 'indexing',
  failure_code text,
  skipped_pages jsonb not null default '[]'::jsonb,
  primary key (owner_id,course_id,source_id,id),
  unique (owner_id,id),
  unique (owner_id,source_id,source_revision),
  foreign key (owner_id,course_id,source_id) references public.sources(owner_id,course_id,id) on delete cascade,
  check (jsonb_typeof(skipped_pages) = 'array'),
  check (storage_key like owner_id::text || '/' || course_id::text || '/%')
);
alter table public.sources add constraint sources_current_version_fk
  foreign key (owner_id,course_id,id,current_version_id)
  references public.source_versions(owner_id,course_id,source_id,id)
  deferrable initially deferred;

create table public.datasets (
  owner_id uuid not null,
  course_id uuid not null,
  source_id uuid not null,
  version_id uuid not null,
  typed_columns jsonb not null,
  units jsonb not null default '{}'::jsonb,
  row_count integer not null check (row_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  normalization_backend text not null default 'learner_state',
  normalized_data_key text not null,
  primary key (owner_id,version_id),
  foreign key (owner_id,course_id,source_id,version_id) references public.source_versions(owner_id,course_id,source_id,id) on delete cascade,
  check (jsonb_typeof(typed_columns) = 'array' and jsonb_typeof(units) = 'object')
);
create index datasets_version_scope_idx on public.datasets(owner_id,course_id,source_id,version_id);

create table public.ingest_jobs (
  owner_id uuid not null,
  course_id uuid not null,
  source_id uuid not null,
  version_id uuid not null,
  id uuid not null,
  parser_revision text not null default 'r2-parser-1',
  state text not null,
  lease_expires_at timestamptz,
  lease_token_digest text,
  retry_count integer not null default 0 check (retry_count >= 0),
  failure_code text,
  primary key (owner_id,id),
  unique (owner_id,version_id,parser_revision),
  foreign key (owner_id,course_id,source_id,version_id) references public.source_versions(owner_id,course_id,source_id,id) on delete cascade,
  check (lease_token_digest is null or lease_token_digest ~ '^[a-f0-9]{64}$')
);
create index ingest_jobs_version_scope_idx on public.ingest_jobs(owner_id,course_id,source_id,version_id);
create index ingest_jobs_pending_idx on public.ingest_jobs(owner_id,state,lease_expires_at) where state in ('pending','processing');

-- Keep historical indexed versions addressable. Search still explicitly scopes
-- allowed current versions; a foreign key cannot replace that retrieval predicate.
create unique index retrieval_passages_locator_scope_idx
  on public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id);
alter table public.retrieval_passages add constraint retrieval_passages_version_fk
  foreign key (owner_id,course_id,source_id,version_id)
  references public.source_versions(owner_id,course_id,source_id,id)
  on delete cascade deferrable initially deferred not valid;
-- Existing installs backfill projectState, then VALIDATE CONSTRAINT. NOT VALID
-- does not exempt new writes: every new passage must satisfy the deferred FK.

create table public.lessons (
  owner_id uuid not null,
  course_id uuid not null,
  id uuid not null,
  goal text not null default '',
  mode text not null default 'text' check (mode in ('text','live','quiet')),
  turn_epoch bigint not null default 0 check (turn_epoch >= 0),
  board_revision bigint not null default 0 check (board_revision >= 0),
  active_source_id uuid,
  active_version_id uuid,
  active_passage_id uuid,
  recap jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  deleted_at timestamptz,
  primary key (owner_id,course_id,id),
  unique (owner_id,id),
  foreign key (owner_id,course_id) references public.courses(owner_id,id) on delete cascade,
  foreign key (owner_id,course_id,active_source_id,active_version_id) references public.source_versions(owner_id,course_id,source_id,id) deferrable initially deferred,
  foreign key (owner_id,course_id,active_source_id,active_version_id,active_passage_id)
    references public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id) deferrable initially deferred
);
create index lessons_source_scope_idx on public.lessons(owner_id,course_id,active_source_id,active_version_id,active_passage_id);

create table public.messages (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  client_message_id text not null,
  role text not null check (role in ('student','tutor')),
  content text not null,
  status text not null default 'complete',
  medium text not null default 'text' check (medium in ('text','voice')),
  played text check (played is null or played in ('unknown','confirmed')),
  created_at timestamptz,
  primary key (owner_id,lesson_id,id),
  unique (owner_id,course_id,lesson_id,id),
  unique (owner_id,lesson_id,client_message_id),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade
);
create index messages_lesson_scope_idx on public.messages(owner_id,course_id,lesson_id);

create table public.message_citations (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  message_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  source_id uuid not null,
  version_id uuid not null,
  passage_id uuid not null,
  locator jsonb not null,
  primary key (owner_id,lesson_id,message_id,ordinal),
  foreign key (owner_id,course_id,lesson_id,message_id) references public.messages(owner_id,course_id,lesson_id,id) on delete cascade,
  foreign key (owner_id,course_id,source_id,version_id,passage_id)
    references public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id) on delete cascade deferrable initially deferred,
  check (jsonb_typeof(locator) = 'object')
);
create index message_citations_message_scope_idx on public.message_citations(owner_id,course_id,lesson_id,message_id);
create index message_citations_source_scope_idx on public.message_citations(owner_id,course_id,source_id,version_id,passage_id);

create table public.board_objects (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  kind text not null check (kind in ('histogram','regression','probability')),
  revision bigint not null check (revision >= 0),
  source_id uuid,
  version_id uuid,
  props jsonb not null,
  primary key (owner_id,lesson_id,id),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  foreign key (owner_id,course_id,source_id,version_id) references public.source_versions(owner_id,course_id,source_id,id) deferrable initially deferred,
  check (jsonb_typeof(props) = 'object')
);
create index board_objects_lesson_scope_idx on public.board_objects(owner_id,course_id,lesson_id);
create index board_objects_source_scope_idx on public.board_objects(owner_id,course_id,source_id,version_id);

create table public.action_events (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  action_id text not null check (length(action_id) between 1 and 128),
  request_id text not null,
  operation text not null,
  status text not null,
  turn_epoch bigint not null check (turn_epoch >= 0),
  prior_revision bigint check (prior_revision is null or prior_revision >= 0),
  new_revision bigint check (new_revision is null or new_revision >= 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb not null,
  primary key (owner_id,lesson_id,action_id),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  check (jsonb_typeof(receipt) = 'object')
);
create index action_events_lesson_scope_idx on public.action_events(owner_id,course_id,lesson_id);

create table public.attempts (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  practice_id uuid not null,
  attempt_index integer not null default 0 check (attempt_index >= 0),
  is_first boolean not null default true,
  skill text not null,
  item_variant text,
  first_response text not null,
  response_hash text not null check (response_hash ~ '^[a-f0-9]{64}$'),
  independent boolean not null,
  hint_depth integer not null check (hint_depth >= 0),
  skipped boolean not null default false,
  outcome jsonb not null,
  rubric_version text not null,
  attempted_at timestamptz,
  primary key (owner_id,lesson_id,id),
  unique (owner_id,lesson_id,practice_id,attempt_index),
  check (is_first = (attempt_index = 0)),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade
);
create index attempts_lesson_scope_idx on public.attempts(owner_id,course_id,lesson_id);
create unique index attempts_one_first_idx on public.attempts(owner_id,lesson_id,practice_id) where is_first;

create table public.grants (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  actor_id uuid not null,
  target_id text,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  nonce_digest text not null check (nonce_digest ~ '^[a-f0-9]{64}$'),
  primary key (owner_id,id),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  check (actor_id = owner_id),
  check (scopes <@ array['notebook.focus','notebook.highlight','notebook.propose','notebook.undo']::text[])
);
create index grants_lesson_scope_idx on public.grants(owner_id,course_id,lesson_id);
create index grants_active_idx on public.grants(owner_id,expires_at) where revoked_at is null;

create table public.usage (
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  event_id text not null,
  reservation_id text not null,
  course_id uuid,
  lesson_id uuid,
  provider text not null default 'google',
  model text,
  event_kind text not null check (event_kind in ('provider_usage','settlement')),
  duration_seconds numeric(12,3),
  token_categories jsonb,
  estimated_usd numeric(18,10),
  rate_version text,
  cost_unknown boolean not null default true,
  close_reason text,
  primary key (owner_id,event_id),
  foreign key (owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  check (duration_seconds is null or duration_seconds >= 0),
  check (estimated_usd is null or estimated_usd >= 0)
);
create index usage_lesson_scope_idx on public.usage(owner_id,course_id,lesson_id);
create index usage_reservation_idx on public.usage(owner_id,reservation_id);

create function public.tutor_domain_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using errcode = '23514', message = 'Confirmed first attempt/action is immutable';
  end if;
  return new;
end $$;
revoke all on function public.tutor_domain_immutable() from public,anon,authenticated,service_role;
create trigger attempts_immutable before update on public.attempts for each row execute function public.tutor_domain_immutable();
create trigger action_events_immutable before update on public.action_events for each row execute function public.tutor_domain_immutable();

create function public.tutor_version_identity_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.owner_id,new.course_id,new.source_id,new.id,new.source_revision,new.content_hash,new.storage_key)
    is distinct from (old.owner_id,old.course_id,old.source_id,old.id,old.source_revision,old.content_hash,old.storage_key) then
    raise exception using errcode = '23514', message = 'Source version identity and content are immutable';
  end if;
  return new;
end $$;
revoke all on function public.tutor_version_identity_immutable() from public,anon,authenticated,service_role;
create trigger source_versions_identity_immutable before update on public.source_versions for each row execute function public.tutor_version_identity_immutable();

create function public.tutor_grant_monotonic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.nonce_digest is distinct from old.nonce_digest or (old.revoked_at is not null and new.revoked_at is null) then
    raise exception using errcode = '23514', message = 'A revoked grant or nonce cannot be reused';
  end if;
  return new;
end $$;
revoke all on function public.tutor_grant_monotonic() from public,anon,authenticated,service_role;
create trigger grants_monotonic before update on public.grants for each row execute function public.tutor_grant_monotonic();

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','entitlements','courses','sources','source_versions','datasets','ingest_jobs','lessons','messages','message_citations','board_objects','action_events','attempts','grants','usage'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
    execute format('grant select,insert,update,delete on public.%I to tutor_api',table_name);
    execute format('create policy %I on public.%I for all to tutor_api using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',table_name || '_api_owner',table_name);
  end loop;
end $$;

comment on table public.datasets is 'Typed metadata; normalized_data_key identifies protected learner_state data until a separate normalized private object is published. No browser table access.';
comment on table public.action_events is 'Immutable minimal committed receipts. No prompts, source excerpts, notebook replacement text or raw provider payloads.';
comment on table public.attempts is 'Immutable first response per lesson/practice item; parent lesson deletion is the explicit erasure boundary.';
comment on table public.usage is 'Allowlisted provider counters and estimate, never an invoice claim. No raw audio, screenshots or transcript content.';
