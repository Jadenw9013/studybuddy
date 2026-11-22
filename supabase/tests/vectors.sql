-- Deterministic source-less vector boards retain the existing scoped board policy.
begin;
insert into auth.users(id,email) values('f1000000-0000-4000-8000-000000000001','vector-probe@example.test');
insert into public.profiles(owner_id) values('f1000000-0000-4000-8000-000000000001');
insert into public.courses(owner_id,id,title) values('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Linear algebra');
insert into public.lessons(owner_id,course_id,id,goal) values('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','Dot products and projection');
set local role tutor_api;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
insert into public.board_objects(owner_id,course_id,lesson_id,id,kind,revision,props)
 values('f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','vectors',1,'{"vectorA":[2,2],"vectorB":[-1,3],"result":{"dot":4,"projection":[-0.4,1.2]}}');
do $$
begin
 if (select (props->'result'->>'dot')::numeric from public.board_objects)<>4 then raise exception 'Vector result did not persist'; end if;
 if (select source_id is not null or version_id is not null from public.board_objects) then raise exception 'Source-less vectors acquired fabricated provenance'; end if;
 begin
  update public.board_objects set kind='untrusted_javascript';
  raise exception 'Unknown visual primitive accepted';
 exception when check_violation then null; end;
end $$;
reset role;
rollback;
