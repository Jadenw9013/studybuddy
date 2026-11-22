-- Durable request digests outlive individual lesson/course purges, avoiding a
-- second paid submission under an already consumed request UUID. Account purge
-- cascades from the profile. No prompts or source text belong in this table.
create table public.studio_requests (
  owner_id uuid not null references public.profiles(owner_id) on delete cascade,
  id uuid not null,
  lesson_id uuid not null,
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  primary key(owner_id,id)
);
create function public.prevent_studio_request_rewrite() returns trigger language plpgsql set search_path='' as $$
begin
 if new.lesson_id is distinct from old.lesson_id or new.fingerprint is distinct from old.fingerprint then
  raise exception 'A Studio request identity cannot be reused' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.prevent_studio_request_rewrite() from public,anon,authenticated,service_role;
create trigger studio_requests_immutable before update on public.studio_requests for each row execute function public.prevent_studio_request_rewrite();
create table public.studio_artifacts (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  kind text not null check(kind in ('guide','flashcards','quiz')),
  status text not null check(status in ('generating','ready','failed','deleted')),
  title text not null check(length(title)<=100),
  content jsonb,
  progress jsonb not null check(jsonb_typeof(progress)='object'),
  coverage jsonb not null check(jsonb_typeof(coverage)='object'),
  error jsonb check(error is null or jsonb_typeof(error)='object'),
  source_version_count integer not null check(source_version_count between 0 and 25),
  revision bigint not null check(revision>0),
  fixture boolean not null,
  turn_epoch bigint not null check(turn_epoch>=0),
  selection_revision bigint not null check(selection_revision>=0),
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null check(updated_at>=created_at),
  primary key(owner_id,lesson_id,id),
  unique(owner_id,id),
  unique(owner_id,course_id,lesson_id,id),
  foreign key(owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  foreign key(owner_id,id) references public.studio_requests(owner_id,id) deferrable initially deferred,
  check((status='ready' and length(title)>0 and content is not null and jsonb_typeof(content)='object' and source_version_count>0)
    or (status in ('generating','failed') and content is null and source_version_count>0)
    or (status='deleted' and title='' and content is null and source_version_count=0 and error is null))
);
create index studio_artifacts_lesson_updated_idx on public.studio_artifacts(owner_id,course_id,lesson_id,updated_at desc);
create table public.studio_artifact_sources (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  artifact_id uuid not null,
  source_id uuid not null,
  version_id uuid not null,
  primary key(owner_id,artifact_id,source_id,version_id),
  foreign key(owner_id,course_id,lesson_id,artifact_id) references public.studio_artifacts(owner_id,course_id,lesson_id,id) on delete cascade,
  foreign key(owner_id,course_id,source_id,version_id) references public.source_versions(owner_id,course_id,source_id,id) on delete cascade deferrable initially deferred
);
create index studio_artifact_sources_version_idx on public.studio_artifact_sources(owner_id,course_id,source_id,version_id);
do $$ declare table_name text; begin
 foreach table_name in array array['studio_requests','studio_artifacts','studio_artifact_sources'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('alter table public.%I force row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
  execute format('grant select,insert,update,delete on public.%I to tutor_api',table_name);
  execute format('create policy %I on public.%I for all to tutor_api using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',table_name||'_api_owner',table_name);
 end loop;
end $$;
