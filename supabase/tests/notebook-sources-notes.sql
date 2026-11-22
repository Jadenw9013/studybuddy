-- Real Postgres probe using isolated synthetic identities; every row rolls back.
begin;
insert into auth.users(id,email) values ('b1000000-0000-4000-8000-000000000001','notebook-one@example.test'),('b1000000-0000-4000-8000-000000000002','notebook-two@example.test');
insert into public.profiles(owner_id) values ('b1000000-0000-4000-8000-000000000001'),('b1000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Synthetic notebook'),('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','Other notebook');
insert into public.sources(owner_id,course_id,id) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001'),('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002');
insert into public.lessons(owner_id,course_id,id) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001');
set constraints all immediate;
set local role tutor_api;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select source_scope_mode from public.lessons)<>'all' then raise exception 'Legacy default source scope changed'; end if;
 if exists(select 1 from public.courses where created_at is not null or updated_at is not null) then raise exception 'Unknown legacy dates were fabricated'; end if;
end $$;
update public.lessons set source_scope_mode='selected',source_scope_revision=1,source_context_message_offset=2;
insert into public.lesson_selected_sources(owner_id,course_id,lesson_id,source_id) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001');
insert into public.saved_notes(owner_id,course_id,lesson_id,id,revision,title,content,citations,creation_fingerprint,created_at,updated_at) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',1,'My summary','My own saved words','[]',repeat('a',64),now(),now());
do $$ begin
 if (select content from public.saved_notes)<>'My own saved words' then raise exception 'Note content did not persist'; end if;
 begin
  insert into public.lesson_selected_sources(owner_id,course_id,lesson_id,source_id) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002');
  raise exception 'Wrong-course source selection accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.saved_notes set course_id='b2000000-0000-4000-8000-000000000002';
  raise exception 'Wrong-course note identity accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.saved_notes set deleted_at=now();
  raise exception 'Deleted note retained unredacted content';
 exception when check_violation then null; end;
 begin
  update public.saved_notes set revision=0;
  raise exception 'Zero note revision accepted';
 exception when check_violation then null; end;
end $$;
delete from public.lesson_selected_sources;
do $$ begin
 if (select source_scope_mode from public.lessons)<>'selected' then raise exception 'Explicit empty scope fell back to all'; end if;
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.saved_notes) or exists(select 1 from public.lesson_selected_sources) then raise exception 'Notebook owner RLS leaked'; end if;
 begin
  insert into public.saved_notes(owner_id,course_id,lesson_id,id,revision,title,content,creation_fingerprint,created_at,updated_at) values ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',1,'Forged','Other owner',repeat('b',64),now(),now());
  raise exception 'Other owner note insertion accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.saved_notes','SELECT') or has_table_privilege('anon','public.saved_notes','INSERT') or has_table_privilege('service_role','public.lesson_selected_sources','UPDATE') then raise exception 'Browser/service roles bypass trusted notebook API'; end if;
end $$;
delete from public.profiles where owner_id='b1000000-0000-4000-8000-000000000001';
do $$ begin
 if exists(select 1 from public.saved_notes where owner_id='b1000000-0000-4000-8000-000000000001') or exists(select 1 from public.lesson_selected_sources where owner_id='b1000000-0000-4000-8000-000000000001') then raise exception 'Account purge retained notebook metadata'; end if;
end $$;
rollback;
