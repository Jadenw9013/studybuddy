-- Trusted structured-data traversal visuals use existing owner/version-scoped boards.
-- Algorithms and coordinates remain bounded JSON metadata validated by the API.
alter table public.board_objects drop constraint board_objects_kind_check;
alter table public.board_objects add constraint board_objects_kind_check
  check (kind in ('histogram','regression','probability','vectors','dsa'));
alter table public.board_objects add constraint board_objects_dsa_source_check
  check (kind <> 'dsa' or (source_id is not null and version_id is not null));
