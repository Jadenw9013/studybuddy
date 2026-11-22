-- User-requested linear-algebra diagrams use the same scoped/revisioned board.
-- Coordinates and computed results are JSON metadata; no executable rendering code.
alter table public.board_objects drop constraint board_objects_kind_check;
alter table public.board_objects add constraint board_objects_kind_check
  check (kind in ('histogram','regression','probability','vectors'));
