-- Synthetic domain/RLS checks. Run as postgres after migrations; all rows roll back.
begin;
insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','domain-one@example.test'),
 ('d1000000-0000-4000-8000-000000000002','domain-two@example.test');
insert into public.learner_state(owner_id,state) values
 ('d1000000-0000-4000-8000-000000000001','{}'),
 ('d1000000-0000-4000-8000-000000000002','{}');
insert into public.profiles(owner_id) values
 ('d1000000-0000-4000-8000-000000000001'),('d1000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Main course'),
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','Wrong same-owner course'),
 ('d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003','Other owner course');
insert into public.sources(owner_id,course_id,id) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001'),
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002');

-- Real worker publication can precede normalized version projection in one txn.
insert into public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id,exact_text,locator) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','Synthetic density rule','{"pageIndex":1}');
insert into public.source_versions(owner_id,course_id,source_id,id,source_revision,content_hash,storage_key,indexing_state) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',1,repeat('a',64),'d1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/source/version','ready'),
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000002',1,repeat('b',64),'d1000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000002/source/version','ready');
update public.sources set current_version_id='d4000000-0000-4000-8000-000000000001'
 where owner_id='d1000000-0000-4000-8000-000000000001' and id='d3000000-0000-4000-8000-000000000001';
insert into public.lessons(owner_id,course_id,id,goal) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','Synthetic lesson');
insert into public.messages(owner_id,course_id,lesson_id,id,client_message_id,role,content) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','tutor','Synthetic explanation');
insert into public.message_citations(owner_id,course_id,lesson_id,message_id,ordinal,source_id,version_id,passage_id,locator) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001',0,'d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','{"pageIndex":1}');
insert into public.entitlements(owner_id,id,period_id,allowance_seconds,remaining_seconds,consumed_seconds,reserved_seconds) values
 ('d1000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','synthetic-pass',4800,4800,0,0);
set constraints all immediate;

set local role tutor_api;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$
declare n integer;
begin
 select count(*) into n from public.profiles;
 if n<>1 then raise exception 'Domain profile owner RLS leaked'; end if;
 select count(*) into n from public.courses;
 if n<>2 then raise exception 'Domain course owner RLS leaked'; end if;
 if (select adult_confirmed_at is not null from public.profiles) then raise exception 'Adult status inferred'; end if;
 begin
  insert into public.messages(owner_id,course_id,lesson_id,id,client_message_id,role,content) values
   ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000002','wrong-course','student','denied');
  raise exception 'Same-owner wrong-course message FK allowed';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.message_citations(owner_id,course_id,lesson_id,message_id,ordinal,source_id,version_id,passage_id,locator) values
   ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001',1,'d3000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000001','{}');
  raise exception 'Same-owner wrong-course citation FK allowed';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.courses(owner_id,id,title) values ('d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000004','denied');
  raise exception 'Different-owner insert allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.source_versions set content_hash=repeat('f',64) where id='d4000000-0000-4000-8000-000000000001';
  raise exception 'Published version bytes were silently replaced';
 exception when check_violation then null; end;
end $$;

insert into public.attempts(owner_id,course_id,lesson_id,id,practice_id,attempt_index,is_first,skill,first_response,response_hash,independent,hint_depth,outcome,rubric_version) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000001',0,true,'histogram','First answer',repeat('c',64),true,0,'{"numeric":false}','synthetic-r1'),
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000001',1,false,'histogram','Assisted retry',repeat('d',64),false,1,'{"numeric":true}','synthetic-r1');
insert into public.action_events(owner_id,course_id,lesson_id,action_id,request_id,operation,status,turn_epoch,payload_hash,receipt) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','same-action','same-action','board.patch','saved',1,repeat('e',64),'{"status":"saved","revision":1}');
insert into public.grants(owner_id,course_id,lesson_id,id,actor_id,scopes,expires_at,nonce_digest) values
 ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','db000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',array['notebook.propose'],now()+interval '5 minutes',repeat('a',64));
do $$
begin
 if (select count(*) from public.attempts)<>2 then raise exception 'Assisted retry disappeared'; end if;
 begin
  update public.attempts set first_response='Overwritten' where id='d9000000-0000-4000-8000-000000000001';
  raise exception 'First attempt was overwritten';
 exception when check_violation then null; end;
 begin
  insert into public.action_events(owner_id,course_id,lesson_id,action_id,request_id,operation,status,turn_epoch,payload_hash,receipt) values
   ('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','same-action','different-request','board.patch','saved',1,repeat('f',64),'{}');
  raise exception 'Duplicate committed action accepted';
 exception when unique_violation then null; end;
 begin
  update public.action_events set payload_hash=repeat('f',64) where action_id='same-action';
  raise exception 'Action ID changed payload';
 exception when check_violation then null; end;
 update public.grants set revoked_at=now() where id='db000000-0000-4000-8000-000000000001';
 begin
  update public.grants set revoked_at=null where id='db000000-0000-4000-8000-000000000001';
  raise exception 'Revoked grant resurrected';
 exception when check_violation then null; end;
 begin
  update public.grants set scopes=array['notebook.apply'] where id='db000000-0000-4000-8000-000000000001';
  raise exception 'Apply granted through database scope';
 exception when check_violation then null; end;
end $$;
reset role;

do $$
declare table_name text;
begin
 foreach table_name in array array['profiles','entitlements','courses','sources','source_versions','datasets','ingest_jobs','lessons','messages','message_citations','board_objects','action_events','attempts','grants','usage'] loop
  if has_table_privilege('authenticated','public.'||table_name,'SELECT') or has_table_privilege('authenticated','public.'||table_name,'UPDATE')
    or has_table_privilege('anon','public.'||table_name,'SELECT') or has_table_privilege('service_role','public.'||table_name,'UPDATE') then
    raise exception 'Browser/service role has direct domain privileges: %',table_name;
  end if;
 end loop;
end $$;

-- Source purge cascades protected locators; course/account erase is explicit.
delete from public.sources where owner_id='d1000000-0000-4000-8000-000000000001' and id='d3000000-0000-4000-8000-000000000001';
do $$
begin
 if exists(select 1 from public.retrieval_passages where owner_id='d1000000-0000-4000-8000-000000000001') then raise exception 'Deleted source passages remain'; end if;
 if exists(select 1 from public.message_citations where owner_id='d1000000-0000-4000-8000-000000000001') then raise exception 'Deleted source citation remains'; end if;
end $$;
delete from public.profiles where owner_id='d1000000-0000-4000-8000-000000000001';
do $$
begin
 if exists(select 1 from public.courses where owner_id='d1000000-0000-4000-8000-000000000001') then raise exception 'Account domain purge failed'; end if;
 if not exists(select 1 from public.courses where owner_id='d1000000-0000-4000-8000-000000000002') then raise exception 'Account purge touched another owner'; end if;
end $$;
rollback;
