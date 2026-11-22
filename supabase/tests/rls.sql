-- Run against local synthetic Supabase only, as postgres. Everything is rolled back.
begin;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001','rls-one@example.test'),
 ('10000000-0000-4000-8000-000000000002','rls-two@example.test');
insert into public.learner_state(owner_id,state) values
 ('10000000-0000-4000-8000-000000000001','{"marker":"one"}'),
 ('10000000-0000-4000-8000-000000000002','{"marker":"two"}');

insert into public.profiles(owner_id) values
 ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into public.courses(owner_id,id,title) values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Main synthetic course'),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Wrong synthetic course'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','Other owner synthetic course');
insert into public.sources(owner_id,course_id,id) values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003');
insert into public.source_versions(owner_id,course_id,source_id,id,source_revision,content_hash,mime_type,original_name,storage_key,indexing_state)
select owner_id::uuid,course_id::uuid,source_id::uuid,version_id::uuid,revision,repeat('a',64),
 'application/pdf','Synthetic RLS fixture.pdf',owner_id||'/'||course_id||'/'||source_id||'/'||version_id,'ready'
from (values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',2),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003',1),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004',1)
) fixture(owner_id,course_id,source_id,version_id,revision);

insert into public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id,exact_text,locator,embedding,embedding_revision)
select owner_id::uuid,course_id::uuid,source_id::uuid,version_id::uuid,passage_id::uuid,
 'Density equals count divided by observations and width','{"pageIndex":1}'::jsonb,
 ('[1,' || repeat('0,',382) || '0]')::extensions.vector,
 '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a'
from (values
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000004')
) as fixture(owner_id,course_id,source_id,version_id,passage_id);

-- Rollback-only tests still force deferred parent/locator constraints to execute.
set constraints all immediate;

set local role tutor_api;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$
declare n integer;
begin
 select count(*) into n from public.learner_state;
 if n <> 1 then raise exception 'RLS read leaked another owner'; end if;
 select count(*) into n from public.retrieval_passages;
 if n <> 3 then raise exception 'Retrieval RLS read leaked another owner'; end if;
 select count(*) into n from public.retrieval_passages
  where owner_id='10000000-0000-4000-8000-000000000001'
    and course_id='20000000-0000-4000-8000-000000000001'
    and version_id=any(array['40000000-0000-4000-8000-000000000001']::uuid[])
    and search @@ websearch_to_tsquery('english','histogram OR density');
 if n <> 1 then raise exception 'Scoped lexical retrieval returned stale/wrong-course evidence'; end if;
 select count(*) into n from (
  select passage_id from public.retrieval_passages
  where owner_id='10000000-0000-4000-8000-000000000001'
    and course_id='20000000-0000-4000-8000-000000000001'
    and version_id=any(array['40000000-0000-4000-8000-000000000001']::uuid[])
    and embedding_revision='5c38ec7c405ec4b44b94cc5a9bb96e735b38267a'
  order by embedding OPERATOR(extensions.<=>) ('[1,' || repeat('0,',382) || '0]')::extensions.vector
  limit 10
 ) scoped;
 if n <> 1 then raise exception 'Scoped vector retrieval returned stale/wrong-course evidence'; end if;
 update public.learner_state set revision=revision+1 where owner_id='10000000-0000-4000-8000-000000000002';
 get diagnostics n = row_count;
 if n <> 0 then raise exception 'RLS write changed another owner'; end if;
 begin
   insert into public.learner_state(owner_id,state) values('10000000-0000-4000-8000-000000000003','{}');
   raise exception 'RLS insert allowed another owner';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;

do $$
begin
 if has_table_privilege('authenticated','public.learner_state','SELECT')
    or has_table_privilege('authenticated','public.learner_state','UPDATE')
    or has_table_privilege('anon','public.learner_state','SELECT') then
    raise exception 'Browser role has direct aggregate access';
 end if;
 if has_table_privilege('authenticated','public.retrieval_passages','SELECT')
    or has_table_privilege('authenticated','public.retrieval_passages','UPDATE') then
    raise exception 'Browser role has direct retrieval index access';
 end if;
 if (select public from storage.buckets where id='course-originals') then
    raise exception 'Original bucket is public';
 end if;
end $$;
rollback;
