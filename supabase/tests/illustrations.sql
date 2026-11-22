-- Optional image metadata/RLS/usage constraints. Synthetic rows always roll back.
begin;
insert into auth.users(id,email) values
 ('e1000000-0000-4000-8000-000000000001','illustration-one@example.test'),
 ('e1000000-0000-4000-8000-000000000002','illustration-two@example.test');
insert into public.profiles(owner_id) values
 ('e1000000-0000-4000-8000-000000000001'),('e1000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Main synthetic course'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','Wrong same-owner course'),
 ('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000003','Other-owner course');
insert into public.lessons(owner_id,course_id,id,goal) values
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Illustration probe'),
 ('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','Other course probe'),
 ('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000003','Other owner probe');
insert into public.illustrations(owner_id,course_id,lesson_id,id,action_id,fingerprint,turn_epoch,board_revision,status,prompt,purpose,title,model,fixture,created_at,updated_at,estimate_usd,price_version,cost_state,pass_id,storage_key,mime,submitted)
select owner_id,course_id,id,
 case id when 'e3000000-0000-4000-8000-000000000001' then 'e4000000-0000-4000-8000-000000000001'::uuid
         when 'e3000000-0000-4000-8000-000000000002' then 'e4000000-0000-4000-8000-000000000002'::uuid
         else 'e4000000-0000-4000-8000-000000000003'::uuid end,
 'action-'||id::text,repeat('a',64),1,0,'ready','Private synthetic prompt','Explain an area concept','Synthetic illustration','flux-2-klein-4b',false,now(),now(),.04,'synthetic-price-v1','estimated','synthetic-pass',
 owner_id::text||'/'||course_id::text||'/illustrations/'||id::text||'/image.png','image/png',true
from public.lessons where owner_id in ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002');
set constraints all immediate;

set local role tutor_api;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
do $$
declare n integer;
begin
 select count(*) into n from public.illustrations;
 if n<>2 then raise exception 'Illustration owner RLS disclosed another learner'; end if;
 delete from public.illustrations where owner_id='e1000000-0000-4000-8000-000000000002';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Illustration RLS deleted another learner image'; end if;
 begin
  insert into public.illustrations(owner_id,course_id,lesson_id,id,action_id,fingerprint,turn_epoch,board_revision,status,prompt,purpose,title,model,fixture,created_at,updated_at,estimate_usd,price_version,cost_state,pass_id)
  values('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000004','wrong-course',repeat('b',64),1,0,'queued','Synthetic','Concept','Synthetic','flux-2-klein-4b',false,now(),now(),.04,'synthetic-price-v1','reserved','synthetic-pass');
  raise exception 'Same-owner wrong-course image metadata accepted';
 exception when foreign_key_violation then null; end;
 begin
  update public.illustrations set storage_key='e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000002/illustrations/e3000000-0000-4000-8000-000000000001/image.png'
   where id='e4000000-0000-4000-8000-000000000001';
  raise exception 'Cross-course image storage key accepted';
 exception when check_violation then null; end;
 begin
  update public.illustrations set mime='image/svg+xml' where id='e4000000-0000-4000-8000-000000000001';
  raise exception 'Active image MIME accepted';
 exception when check_violation then null; end;
 begin
  update public.illustrations set storage_key=null where id='e4000000-0000-4000-8000-000000000001';
  raise exception 'Ready image lacks private bytes';
 exception when check_violation then null; end;
 begin
  update public.illustrations set fingerprint=repeat('f',64) where id='e4000000-0000-4000-8000-000000000001';
  raise exception 'Image action identity changed';
 exception when check_violation then null; end;
end $$;

insert into public.usage(owner_id,event_id,reservation_id,course_id,lesson_id,provider,model,event_kind,duration_seconds,token_categories,estimated_usd,rate_version,cost_unknown)
values('e1000000-0000-4000-8000-000000000001','illustration:e4000000-0000-4000-8000-000000000001','illustration:e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','bfl','flux-2-klein-4b','illustration_estimate',null,null,.04,'synthetic-price-v1',false);
reset role;
do $$
declare role_name text;
begin
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(role_name,'public.illustrations','SELECT') or has_table_privilege(role_name,'public.illustrations','UPDATE') then
   raise exception 'Raw illustration metadata exposed to browser/service role';
  end if;
 end loop;
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.illustrations'::regclass) then
  raise exception 'Illustration RLS is not forced';
 end if;
end $$;

delete from public.lessons where owner_id='e1000000-0000-4000-8000-000000000001' and id='e3000000-0000-4000-8000-000000000001';
do $$
begin
 if exists(select 1 from public.illustrations where id='e4000000-0000-4000-8000-000000000001') then raise exception 'Lesson purge retained illustration'; end if;
 if exists(select 1 from public.usage where event_id='illustration:e4000000-0000-4000-8000-000000000001') then raise exception 'Lesson purge retained illustration usage'; end if;
end $$;
delete from public.courses where owner_id='e1000000-0000-4000-8000-000000000001' and id='e2000000-0000-4000-8000-000000000002';
do $$
begin
 if exists(select 1 from public.illustrations where id='e4000000-0000-4000-8000-000000000002') then raise exception 'Course purge retained illustration'; end if;
 if not exists(select 1 from public.illustrations where id='e4000000-0000-4000-8000-000000000003') then raise exception 'Course purge touched another owner'; end if;
end $$;
delete from public.profiles where owner_id='e1000000-0000-4000-8000-000000000002';
do $$
begin
 if exists(select 1 from public.illustrations where id='e4000000-0000-4000-8000-000000000003') then raise exception 'Account purge retained illustration'; end if;
end $$;
rollback;
