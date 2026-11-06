-- Supabase hosted defaults grant EXECUTE explicitly to anon/authenticated.
-- Preserve data and policy behavior while keeping internal definers out of the Data API.
begin;
create schema inkstrip_private;
revoke all on schema inkstrip_private from public,anon;
grant usage on schema inkstrip_private to authenticated,service_role;

alter function public.inkstrip_email_verified() set schema inkstrip_private;
alter function public.inkstrip_verified_user() set schema inkstrip_private;
alter function public.inkstrip_owns_path(text) set schema inkstrip_private;
alter function public.inkstrip_profile_from_auth() set schema inkstrip_private;
-- Stored policies and the auth trigger retain their function-OID dependencies.
-- SQL-string function bodies must explicitly reference the new private namespace.
create or replace function inkstrip_private.inkstrip_verified_user() returns uuid
language sql stable security definer set search_path='' as $$
 select p.id from public.inkstrip_profiles p where p.id=(select auth.uid())
 and p.deleting_at is null and inkstrip_private.inkstrip_email_verified()
$$;
create or replace function inkstrip_private.inkstrip_owns_path(object_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inkstrip_cloud_projects p
 where p.owner_id=(select inkstrip_private.inkstrip_verified_user())
 and object_path ~ ('^'||p.owner_id::text||'/'||p.id::text||'/[a-f0-9]{64}\.part$'))
$$;
revoke all on function inkstrip_private.inkstrip_email_verified(),inkstrip_private.inkstrip_verified_user(),inkstrip_private.inkstrip_owns_path(text),inkstrip_private.inkstrip_profile_from_auth() from public,anon,authenticated,service_role;
-- Policy expressions need execute permission, but the schema is not exposed to PostgREST.
grant execute on function inkstrip_private.inkstrip_email_verified(),inkstrip_private.inkstrip_verified_user(),inkstrip_private.inkstrip_owns_path(text) to authenticated,service_role;
alter function public.inkstrip_schema_version() set search_path='';

alter policy profile_read on public.inkstrip_profiles using(id=(select auth.uid()) and (select inkstrip_private.inkstrip_email_verified()));
alter policy profile_update on public.inkstrip_profiles
 using(id=(select auth.uid()) and deleting_at is null and (select inkstrip_private.inkstrip_email_verified()))
 with check(id=(select auth.uid()) and deleting_at is null and (select inkstrip_private.inkstrip_email_verified()));
alter policy projects_read on public.inkstrip_cloud_projects using(owner_id=(select inkstrip_private.inkstrip_verified_user()));
alter policy chunks_read on public.inkstrip_cloud_chunks using(owner_id=(select inkstrip_private.inkstrip_verified_user()));
alter policy revisions_read on public.inkstrip_cloud_revisions using(owner_id=(select inkstrip_private.inkstrip_verified_user()));

revoke all on public.inkstrip_cloud_project_overview from public,anon,authenticated;
grant select on public.inkstrip_cloud_project_overview to authenticated,service_role;
create index inkstrip_actions_user_idx on public.inkstrip_account_actions(user_id);
create index inkstrip_chunks_project_owner_idx on public.inkstrip_cloud_chunks(project_id,owner_id);
create index inkstrip_revisions_project_owner_idx on public.inkstrip_cloud_revisions(project_id,owner_id);
commit;
