-- Synthetic structured-source board constraints/RLS; all inserted rows roll back.
begin;
insert into auth.users(id,email) values ('e1000000-0000-4000-8000-000000000001','dsa-probe-one@example.test'),('e1000000-0000-4000-8000-000000000002','dsa-probe-two@example.test');
insert into public.profiles(owner_id) values ('e1000000-0000-4000-8000-000000000001'),('e1000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Synthetic DSA');
insert into public.sources(owner_id,course_id,id) values ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
insert into public.source_versions(owner_id,course_id,source_id,id,content_hash,storage_key,mime_type,indexing_state) values ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',repeat('a',64),'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/synthetic/graph.json','application/json','ready');
insert into public.lessons(owner_id,course_id,id) values ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001');
set constraints all immediate;
set local role tutor_api;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
insert into public.board_objects(owner_id,course_id,lesson_id,id,kind,revision,source_id,version_id,props) values ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','dsa',1,'e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','{"algorithm":"bfs","stepIndex":1,"result":{"order":["A","B"],"steps":[{"currentId":null},{"currentId":"A","frontierIds":["B"],"visitedIds":["A"]}]}}');
do $$
begin
 if (select props->>'algorithm' from public.board_objects)<>'bfs' then raise exception 'Structured traversal metadata did not persist'; end if;
 begin
  update public.board_objects set source_id=null,version_id=null;
  raise exception 'DSA source provenance was optional';
 exception when check_violation then null; end;
 begin
  update public.board_objects set version_id='e4000000-0000-4000-8000-000000000099';
  raise exception 'Unknown DSA source version accepted';
 exception when foreign_key_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.board_objects) then raise exception 'DSA board owner RLS leaked'; end if;
end $$;
reset role;
rollback;
