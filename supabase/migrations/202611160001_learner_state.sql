-- Revision 2 pilot implementation: one serialized aggregate per authorized learner.
-- Course/lesson/source identities are checked in trusted API code, never by model text.
-- Separate API role prevents PostgREST clients from altering entitlement/action state.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tutor_api') then
    create role tutor_api nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;

grant tutor_api to postgres;
grant usage on schema public, auth to tutor_api;
grant execute on function auth.uid() to tutor_api;

create table public.learner_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint learner_state_is_object check (jsonb_typeof(state) = 'object')
);

alter table public.learner_state enable row level security;
alter table public.learner_state force row level security;
revoke all on public.learner_state from public, anon, authenticated;
grant select, insert, update, delete on public.learner_state to tutor_api;

create policy learner_state_api_owner on public.learner_state
  for all to tutor_api
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

comment on table public.learner_state is
  'Private API aggregate; lock row FOR UPDATE, validate action/revision, commit snapshot before broadcasting. Authenticated browser roles have no table privileges.';

-- Private originals: the API checks live ownership/tombstones on every range request.
-- Browser storage SDK downloads and bearer download links are deliberately not used.
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-originals', 'course-originals', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy course_originals_api_only on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'course-originals')
  with check (bucket_id <> 'course-originals');

-- No public or authenticated storage policy is added for this private bucket.
-- Service-role storage credential stays server-side and never authorizes application reads.
