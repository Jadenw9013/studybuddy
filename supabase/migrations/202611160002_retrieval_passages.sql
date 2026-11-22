create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to tutor_api;

create table public.retrieval_passages (
  owner_id uuid not null references public.learner_state(owner_id) on delete cascade,
  course_id uuid not null,
  source_id uuid not null,
  version_id uuid not null,
  passage_id uuid not null,
  exact_text text not null check (length(exact_text) between 1 and 12000),
  locator jsonb not null check (jsonb_typeof(locator) = 'object'),
  embedding extensions.vector(384),
  embedding_revision text,
  search tsvector generated always as (to_tsvector('english'::regconfig, exact_text)) stored,
  created_at timestamptz not null default now(),
  primary key(owner_id, passage_id),
  constraint embedding_has_revision check (embedding is null or embedding_revision is not null)
);

-- Scope first. Exact vector distance on the small pilot's authorized rows avoids
-- approximate-neighbor post-filter losses and does not require an ANN index.
create index retrieval_passages_scope_idx on public.retrieval_passages(owner_id, course_id, version_id);
create index retrieval_passages_source_idx on public.retrieval_passages(owner_id, source_id);
create index retrieval_passages_search_idx on public.retrieval_passages using gin(search);
alter table public.retrieval_passages enable row level security;
alter table public.retrieval_passages force row level security;
revoke all on public.retrieval_passages from public, anon, authenticated;
grant select, insert, update, delete on public.retrieval_passages to tutor_api;
create policy retrieval_passages_api_owner on public.retrieval_passages
  for all to tutor_api
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

comment on table public.retrieval_passages is
  'Private retrieval index; publish with current-source/lease-fenced learner_state transaction. Every query additionally checks course and allowed current version IDs.';
