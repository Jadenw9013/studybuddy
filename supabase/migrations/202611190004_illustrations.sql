-- Optional illustration metadata. Bytes stay in the existing private bucket;
-- browser reads go through the authorized lesson API, never direct table/storage.
create table public.illustrations (
  owner_id uuid not null,
  course_id uuid not null,
  lesson_id uuid not null,
  id uuid not null,
  action_id text not null check (length(action_id) between 1 and 128),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  turn_epoch bigint not null check (turn_epoch >= 0),
  board_revision bigint not null check (board_revision >= 0),
  status text not null check (status in ('queued','generating','ready','failed','cancelled','stale')),
  prompt text not null check (length(prompt) between 1 and 16000),
  purpose text not null check (length(purpose) between 1 and 2000),
  title text not null check (length(title) between 1 and 200),
  model text not null check (length(model) between 1 and 128),
  fixture boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  estimate_usd numeric(18,10) not null check (estimate_usd >= 0),
  price_version text not null check (length(price_version) between 1 and 128),
  cost_state text not null check (cost_state in ('reserved','estimated','unknown','released')),
  pass_id text not null check (length(pass_id) between 1 and 256),
  provider_id text check (provider_id is null or length(provider_id) between 1 and 256),
  storage_key text,
  mime text check (mime is null or mime in ('image/png','image/jpeg','image/webp')),
  message text check (message is null or length(message) <= 1000),
  submitted boolean not null default false,
  primary key (owner_id,lesson_id,id),
  unique (owner_id,id),
  unique (owner_id,lesson_id,action_id),
  foreign key (owner_id,course_id,lesson_id)
    references public.lessons(owner_id,course_id,id) on delete cascade,
  check (updated_at >= created_at),
  check (storage_key is null or (
    storage_key like owner_id::text || '/' || course_id::text || '/illustrations/' || lesson_id::text || '/%'
    and storage_key !~ '(^|/)\.\.?(/|$)'
  )),
  check (status <> 'ready' or (storage_key is not null and mime is not null))
);
create index illustrations_lesson_scope_idx on public.illustrations(owner_id,course_id,lesson_id);
create index illustrations_status_idx on public.illustrations(owner_id,status) where status in ('queued','generating');
alter table public.illustrations enable row level security;
alter table public.illustrations force row level security;
revoke all on public.illustrations from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.illustrations to tutor_api;
create policy illustrations_api_owner on public.illustrations
  for all to tutor_api
  using (owner_id=(select auth.uid()))
  with check (owner_id=(select auth.uid()));

create function public.tutor_illustration_identity_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.owner_id,new.course_id,new.lesson_id,new.id,new.action_id,new.fingerprint,new.created_at)
    is distinct from (old.owner_id,old.course_id,old.lesson_id,old.id,old.action_id,old.fingerprint,old.created_at) then
    raise exception using errcode='23514',message='Illustration action identity is immutable';
  end if;
  return new;
end $$;
revoke all on function public.tutor_illustration_identity_immutable() from public,anon,authenticated,service_role;
create trigger illustrations_identity_immutable before update on public.illustrations
  for each row execute function public.tutor_illustration_identity_immutable();

alter table public.usage drop constraint usage_event_kind_check;
alter table public.usage add constraint usage_event_kind_check
  check (event_kind in ('provider_usage','settlement','illustration_estimate'));
comment on table public.illustrations is
  'Private optional illustration metadata; prompts/storage keys stay server-side. No provider payload, URL, image bytes, or browser table access.';
