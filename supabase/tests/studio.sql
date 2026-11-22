-- Isolated synthetic Studio metadata/RLS/lifecycle probe, rolled back entirely.
begin;
insert into auth.users(id,email) values ('c1000000-0000-4000-8000-000000000001','studio-one@example.test'),('c1000000-0000-4000-8000-000000000002','studio-two@example.test');
insert into public.profiles(owner_id) values ('c1000000-0000-4000-8000-000000000001'),('c1000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic Studio');
insert into public.sources(owner_id,course_id,id) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001');
insert into public.source_versions(owner_id,course_id,source_id,id,content_hash,storage_key) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',repeat('a',64),'c1000000-0000-4000-8000-000000000001/c2000000-0000-4000-8000-000000000001/synthetic/file');
insert into public.lessons(owner_id,course_id,id) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001');
set constraints all immediate;
set local role tutor_api;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
insert into public.studio_requests(owner_id,id,lesson_id,fingerprint) values ('c1000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001',repeat('b',64));
insert into public.studio_artifacts(owner_id,course_id,lesson_id,id,kind,status,title,content,progress,coverage,source_version_count,revision,fixture,turn_epoch,selection_revision,request_fingerprint,created_at,updated_at) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','guide','generating','Study guide',null,'{"cursor":0,"knownCardIds":[],"answers":{}}','{"selectedSourceCount":1,"usedSourceCount":1,"passageCount":1}',1,1,true,0,0,repeat('b',64),now(),now());
insert into public.studio_artifact_sources(owner_id,course_id,lesson_id,artifact_id,source_id,version_id) values ('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001');
do $$ begin
 begin
  update public.studio_artifacts set status='ready';
  raise exception 'Ready artifact without complete content accepted';
 exception when check_violation then null; end;
 begin
  update public.studio_requests set fingerprint=repeat('c',64);
  raise exception 'Consumed request identity rewritten';
 exception when check_violation then null; end;
 begin
  update public.studio_artifact_sources set version_id='c4000000-0000-4000-8000-000000000099';
  raise exception 'Unknown artifact source version accepted';
 exception when foreign_key_violation then null; end;
end $$;
update public.studio_artifacts set status='ready',content='{"sections":[{"heading":"Rule","text":"Synthetic supported content"}]}',revision=2;
do $$ begin
 if (select content->'sections'->0->>'text' from public.studio_artifacts)<>'Synthetic supported content' then raise exception 'Studio content did not persist'; end if;
 begin
  update public.studio_artifacts set status='deleted',source_version_count=0;
  raise exception 'Deleted artifact retained source content';
 exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.studio_artifacts) or exists(select 1 from public.studio_artifact_sources) or exists(select 1 from public.studio_requests) then raise exception 'Studio owner RLS leaked'; end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.studio_artifacts','SELECT') or has_table_privilege('anon','public.studio_requests','INSERT') or has_table_privilege('service_role','public.studio_artifact_sources','UPDATE') then raise exception 'Direct roles bypassed Studio API'; end if;
end $$;
delete from public.lessons where owner_id='c1000000-0000-4000-8000-000000000001';
do $$ begin
 if exists(select 1 from public.studio_artifacts where owner_id='c1000000-0000-4000-8000-000000000001') or exists(select 1 from public.studio_artifact_sources where owner_id='c1000000-0000-4000-8000-000000000001') then raise exception 'Lesson purge retained study content'; end if;
 if not exists(select 1 from public.studio_requests where owner_id='c1000000-0000-4000-8000-000000000001') then raise exception 'Lesson purge erased anti-replay request digest'; end if;
end $$;
delete from public.profiles where owner_id='c1000000-0000-4000-8000-000000000001';
do $$ begin
 if exists(select 1 from public.studio_requests where owner_id='c1000000-0000-4000-8000-000000000001') then raise exception 'Account purge retained Studio request metadata'; end if;
end $$;
rollback;
