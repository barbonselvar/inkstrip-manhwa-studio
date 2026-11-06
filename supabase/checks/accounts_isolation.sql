-- Portable SQL policy check, not Auth/Storage HTTP E2E. Every synthetic row is rolled back.
-- Never commit this transaction or substitute an existing user/project ID.
begin;
create temporary table inkstrip_qa_context(a uuid,b uuid,u uuid,pa uuid,pb uuid,pu uuid) on commit drop;
insert into inkstrip_qa_context values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null,null);
create temporary table inkstrip_qa_checks(name text not null) on commit drop;
do $$ begin execute format('grant usage on schema %I to authenticated,anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant select on inkstrip_qa_context to authenticated,anon;
grant insert,select on inkstrip_qa_checks to authenticated,anon;
create function pg_temp.inkstrip_qa_assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'INKSTRIP_QA_FAILED: %',label;end if;
 insert into pg_temp.inkstrip_qa_checks values(label);
end $$;
grant execute on function pg_temp.inkstrip_qa_assert(boolean,text) to authenticated,anon;

do $$
declare c record;r jsonb;p uuid;owner_id uuid;d text;
begin
 select * into c from pg_temp.inkstrip_qa_context;
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
 values(c.a,'inkstrip-sql-qa-'||c.a||'@example.invalid',now(),'{"display_name":"SQL QA A"}','{}'),
 (c.b,'inkstrip-sql-qa-'||c.b||'@example.invalid',now(),'{"display_name":"SQL QA B"}','{}'),
 (c.u,'inkstrip-sql-qa-'||c.u||'@example.invalid',null,'{"display_name":"SQL QA unverified"}','{}');
 update pg_temp.inkstrip_qa_context set
 pa=(public.inkstrip_open_project(c.a,'qa:'||c.a,'SQL isolation A')->>'id')::uuid,
 pb=(public.inkstrip_open_project(c.b,'qa:'||c.b,'SQL isolation B')->>'id')::uuid,
 pu=(public.inkstrip_open_project(c.u,'qa:'||c.u,'SQL isolation unverified')->>'id')::uuid;
 select * into c from pg_temp.inkstrip_qa_context;
 for p,owner_id,d in select c.pa,c.a,repeat('a',64) union all select c.pb,c.b,repeat('b',64) loop
  insert into public.inkstrip_cloud_chunks(project_id,owner_id,digest,bytes,path)
  values(p,owner_id,d,10,owner_id::text||'/'||p::text||'/'||d||'.part');
  r:=public.inkstrip_commit_revision(owner_id,p,0,jsonb_build_object('version',1,'bytes',10,'parts',jsonb_build_array(jsonb_build_object('digest',d,'bytes',10))),d,'SQL QA revision');
  perform pg_temp.inkstrip_qa_assert((r->>'revision')::int=1,'service fixture revision publication');
  -- Metadata only: this creates no physical uploaded file; HTTP upload tests are separate.
  insert into storage.objects(bucket_id,name) values('inkstrip-private',owner_id::text||'/'||p::text||'/'||d||'.part');
 end loop;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select a::text from pg_temp.inkstrip_qa_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select a from pg_temp.inkstrip_qa_context),'role','authenticated')::text,true);
do $$
declare c record;n int;
begin
 select * into c from pg_temp.inkstrip_qa_context;
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from public.inkstrip_profiles where id=c.a),'A reads own verified profile');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_profiles where id=c.b),'A cannot read B profile');
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from public.inkstrip_cloud_projects where id=c.pa),'A reads own project');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_projects where id=c.pb),'A cannot read B project');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_project_overview where id=c.pb),'view preserves B isolation');
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from public.inkstrip_cloud_revisions where project_id=c.pa),'A reads own revision');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_revisions where project_id=c.pb),'A cannot read B revision');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_chunks where project_id=c.pb),'A cannot read B chunk receipts');
 update public.inkstrip_profiles set display_name='SQL own update' where id=c.a;
 get diagnostics n=row_count;perform pg_temp.inkstrip_qa_assert(n=1,'A can update allowed own profile fields');
 update public.inkstrip_profiles set display_name='Forbidden QA change' where id=c.b;
 get diagnostics n=row_count;perform pg_temp.inkstrip_qa_assert(n=0,'A cannot modify B profile');
 begin
  update public.inkstrip_profiles set email='forged@example.invalid' where id=c.a;
  raise exception 'INKSTRIP_QA_FAILED: auth-owned profile column write allowed';
 exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'auth-owned profile column write denied');end;
 begin
  insert into public.inkstrip_cloud_projects(owner_id,local_id,title) values(c.b,'forged-qa','Forbidden');
  raise exception 'INKSTRIP_QA_FAILED: forged owner insert allowed';
 exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'forged project ownership denied');end;
 begin
  perform public.inkstrip_open_project(c.b,'forged-rpc','Forbidden');
  raise exception 'INKSTRIP_QA_FAILED: service RPC allowed';
 exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'service RPC denied to authenticated');end;
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from storage.objects where bucket_id='inkstrip-private' and name=c.a::text||'/'||c.pa::text||'/'||repeat('a',64)||'.part'),'A sees own storage metadata');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from storage.objects where bucket_id='inkstrip-private' and name=c.b::text||'/'||c.pb::text||'/'||repeat('b',64)||'.part'),'A cannot see B storage metadata');
 insert into storage.objects(bucket_id,name) values('inkstrip-private',c.a::text||'/'||c.pa::text||'/'||repeat('c',64)||'.part');
 perform pg_temp.inkstrip_qa_assert(true,'A can insert own valid storage path');
 begin
  insert into storage.objects(bucket_id,name) values('inkstrip-private',c.b::text||'/'||c.pb::text||'/'||repeat('d',64)||'.part');
  raise exception 'INKSTRIP_QA_FAILED: cross-owner storage insert allowed';
 exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'cross-owner storage insert denied');end;
 update storage.objects set name=c.a::text||'/'||c.pa::text||'/'||repeat('e',64)||'.part' where bucket_id='inkstrip-private' and name=c.a::text||'/'||c.pa::text||'/'||repeat('a',64)||'.part';
 get diagnostics n=row_count;perform pg_temp.inkstrip_qa_assert(n=0,'immutable storage metadata update denied');
 delete from storage.objects where bucket_id='inkstrip-private' and name=c.b::text||'/'||c.pb::text||'/'||repeat('b',64)||'.part';
 get diagnostics n=row_count;perform pg_temp.inkstrip_qa_assert(n=0,'foreign storage metadata delete denied');
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select b::text from pg_temp.inkstrip_qa_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select b from pg_temp.inkstrip_qa_context),'role','authenticated')::text,true);
do $$ declare c record;begin select * into c from pg_temp.inkstrip_qa_context;
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from public.inkstrip_cloud_projects where id=c.pb),'B reads own project');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_projects where id=c.pa),'B cannot read A project');
 perform pg_temp.inkstrip_qa_assert((select display_name='SQL QA B' from public.inkstrip_profiles where id=c.b),'B profile survived forbidden update');
 perform pg_temp.inkstrip_qa_assert((select count(*)=1 from storage.objects where bucket_id='inkstrip-private' and name=c.b::text||'/'||c.pb::text||'/'||repeat('b',64)||'.part'),'B object metadata survived forbidden delete');
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select u::text from pg_temp.inkstrip_qa_context),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select u from pg_temp.inkstrip_qa_context),'role','authenticated')::text,true);
do $$ declare c record;begin select * into c from pg_temp.inkstrip_qa_context;
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_profiles where id=c.u),'unverified own profile denied');
 perform pg_temp.inkstrip_qa_assert((select count(*)=0 from public.inkstrip_cloud_projects where id=c.pu),'unverified own project denied');
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ begin
 begin perform 1 from public.inkstrip_cloud_projects limit 0;raise exception 'INKSTRIP_QA_FAILED: anon table grant';exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'anonymous private table access denied');end;
 begin perform pg_temp.inkstrip_qa_assert((select count(*)=0 from storage.objects where bucket_id='inkstrip-private'),'anonymous storage metadata denied');exception when insufficient_privilege then perform pg_temp.inkstrip_qa_assert(true,'anonymous storage metadata grant denied');end;
end $$;
reset role;
select jsonb_build_object('status','passed','mode','transactional SQL role tests; not Auth/Storage HTTP E2E','assertions',count(*),'checks',jsonb_agg(name)) as report from pg_temp.inkstrip_qa_checks;
rollback;
