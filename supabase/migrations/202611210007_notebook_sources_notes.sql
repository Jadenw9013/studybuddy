-- Nullable legacy dates remain unknown; only observed app events set new dates.
alter table public.courses add column created_at timestamptz, add column updated_at timestamptz;
alter table public.lessons
  add column created_at timestamptz,
  add column updated_at timestamptz,
  add column source_scope_mode text not null default 'all' check (source_scope_mode in ('all','selected')),
  add column source_scope_revision bigint not null default 0 check (source_scope_revision >= 0),
  add column source_context_message_offset integer not null default 0 check (source_context_message_offset >= 0);

create table public.lesson_selected_sources (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  source_id uuid not null,
  primary key(owner_id,lesson_id,source_id),
  foreign key(owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  foreign key(owner_id,course_id,source_id) references public.sources(owner_id,course_id,id) on delete cascade
);
create index lesson_selected_sources_source_idx on public.lesson_selected_sources(owner_id,course_id,source_id);

create table public.saved_notes (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  revision bigint not null check (revision > 0),
  title text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  from_message_id text check (length(from_message_id) between 1 and 128),
  creation_fingerprint text not null check (creation_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key(owner_id,lesson_id,id),
  unique(owner_id,id),
  foreign key(owner_id,course_id,lesson_id) references public.lessons(owner_id,course_id,id) on delete cascade,
  check(updated_at >= created_at),
  check(jsonb_typeof(citations)='array' and jsonb_array_length(citations)<=25),
  check((deleted_at is null and length(title) between 1 and 120 and length(content) between 1 and 20000)
    or (deleted_at is not null and title='' and content='' and citations='[]'::jsonb))
);
create index saved_notes_lesson_updated_idx on public.saved_notes(owner_id,course_id,lesson_id,updated_at desc);

alter table public.lesson_selected_sources enable row level security;
alter table public.lesson_selected_sources force row level security;
alter table public.saved_notes enable row level security;
alter table public.saved_notes force row level security;
revoke all on public.lesson_selected_sources,public.saved_notes from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.lesson_selected_sources,public.saved_notes to tutor_api;
create policy lesson_selected_sources_api_owner on public.lesson_selected_sources for all to tutor_api
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy saved_notes_api_owner on public.saved_notes for all to tutor_api
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
-- Source citation identifiers/locators are API-resolved metadata. They remain as
-- unavailable historical references when source bytes are explicitly removed;
-- reading a note never bypasses the source-content authorization endpoint.
