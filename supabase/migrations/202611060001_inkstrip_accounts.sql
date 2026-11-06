-- Apply only to the owner's Supabase project. No local IndexedDB/Neon data changes.
begin;
create table public.inkstrip_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Creator' check (char_length(display_name) between 2 and 80),
 email text, avatar_url text check (avatar_url is null or (length(avatar_url)<=1024 and avatar_url ~ '^https://')),
 providers jsonb not null default '[]', preferences jsonb not null default '{}' check (jsonb_typeof(preferences)='object' and octet_length(preferences::text)<=16384),
 terms_version text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleting_at timestamptz
);
create table public.inkstrip_cloud_projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 local_id text not null check(length(local_id) between 1 and 200),title text not null check(length(title) between 1 and 300),
 head_revision integer not null default 0 check(head_revision>=0), created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(owner_id,local_id),unique(id,owner_id)
);
create table public.inkstrip_cloud_chunks (
 project_id uuid not null,owner_id uuid not null,digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 bytes integer not null check(bytes between 1 and 2097152), path text not null unique,
 created_at timestamptz not null default now(),primary key(project_id,digest),
 foreign key(project_id,owner_id) references public.inkstrip_cloud_projects(id,owner_id) on delete cascade,
 check(path=owner_id::text||'/'||project_id::text||'/'||digest||'.part')
);
create table public.inkstrip_cloud_revisions (
 project_id uuid not null,owner_id uuid not null,revision integer not null check(revision>0),
 manifest jsonb not null,manifest_hash text not null check(manifest_hash ~ '^[a-f0-9]{64}$'),bytes bigint not null check(bytes between 1 and 2000000000),
 created_at timestamptz not null default now(),primary key(project_id,revision),
 foreign key(project_id,owner_id) references public.inkstrip_cloud_projects(id,owner_id) on delete cascade
);
create table public.inkstrip_rate_limits (key text primary key check(key ~ '^[a-f0-9]{64}$'),ends_at timestamptz not null,used integer not null);
create table public.inkstrip_account_actions (
 id_hash text primary key check(id_hash ~ '^[a-f0-9]{64}$'),kind text not null check(kind in ('oauth_signin','oauth_reauth','oauth_link','recovery','fresh')),
 user_id uuid references auth.users(id) on delete cascade,session_id text,expires_at timestamptz not null,consumed_at timestamptz
);
create table public.inkstrip_account_audit (
 id uuid primary key default gen_random_uuid(),user_id uuid, event text not null check(length(event)<=64), outcome text not null check(outcome in ('ok','denied','error')),
 request_id uuid not null,created_at timestamptz not null default now()
);
create index on public.inkstrip_cloud_projects(owner_id,updated_at desc);
create index on public.inkstrip_rate_limits(ends_at);
create index on public.inkstrip_account_actions(expires_at);
create index on public.inkstrip_account_audit(created_at);
create function public.inkstrip_profile_from_auth() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.inkstrip_profiles(id,display_name,email,providers,terms_version)
 values(new.id,case when length(coalesce(new.raw_user_meta_data->>'display_name','')) between 2 and 80 then new.raw_user_meta_data->>'display_name' else 'Creator' end,
 new.email,coalesce(new.raw_app_meta_data->'providers','[]'::jsonb),new.raw_user_meta_data->>'terms_version')
 on conflict(id) do update set email=excluded.email,providers=excluded.providers,updated_at=now();
 return new;
end $$;
create trigger inkstrip_auth_profile after insert or update of email,raw_app_meta_data on auth.users for each row execute function public.inkstrip_profile_from_auth();
insert into public.inkstrip_profiles(id,email,providers) select id,email,coalesce(raw_app_meta_data->'providers','[]'::jsonb) from auth.users on conflict(id) do nothing;
create function public.inkstrip_email_verified() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
$$;
create function public.inkstrip_verified_user() returns uuid language sql stable security definer set search_path='' as $$
 select p.id from public.inkstrip_profiles p where p.id=auth.uid() and p.deleting_at is null and public.inkstrip_email_verified()
$$;
create function public.inkstrip_owns_path(object_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.inkstrip_cloud_projects p where p.owner_id=public.inkstrip_verified_user()
 and object_path ~ ('^'||p.owner_id::text||'/'||p.id::text||'/[a-f0-9]{64}\.part$'))
$$;
-- Every application table has RLS. Internal ledgers have no browser policies.
alter table public.inkstrip_profiles enable row level security;
alter table public.inkstrip_cloud_projects enable row level security;
alter table public.inkstrip_cloud_chunks enable row level security;
alter table public.inkstrip_cloud_revisions enable row level security;
alter table public.inkstrip_rate_limits enable row level security;
alter table public.inkstrip_account_actions enable row level security;
alter table public.inkstrip_account_audit enable row level security;
create policy profile_read on public.inkstrip_profiles for select to authenticated using(id=auth.uid() and public.inkstrip_email_verified());
create policy profile_update on public.inkstrip_profiles for update to authenticated using(id=auth.uid() and deleting_at is null and public.inkstrip_email_verified()) with check(id=auth.uid());
create policy projects_read on public.inkstrip_cloud_projects for select to authenticated using(owner_id=public.inkstrip_verified_user());
create policy chunks_read on public.inkstrip_cloud_chunks for select to authenticated using(owner_id=public.inkstrip_verified_user());
create policy revisions_read on public.inkstrip_cloud_revisions for select to authenticated using(owner_id=public.inkstrip_verified_user());
revoke all on public.inkstrip_profiles,public.inkstrip_cloud_projects,public.inkstrip_cloud_chunks,public.inkstrip_cloud_revisions,public.inkstrip_rate_limits,public.inkstrip_account_actions,public.inkstrip_account_audit from anon,authenticated;
grant select on public.inkstrip_profiles,public.inkstrip_cloud_projects,public.inkstrip_cloud_chunks,public.inkstrip_cloud_revisions to authenticated;
grant update(display_name,avatar_url,preferences,updated_at) on public.inkstrip_profiles to authenticated;
grant all on public.inkstrip_profiles,public.inkstrip_cloud_projects,public.inkstrip_cloud_chunks,public.inkstrip_cloud_revisions,public.inkstrip_rate_limits,public.inkstrip_account_actions,public.inkstrip_account_audit to service_role;
create view public.inkstrip_cloud_project_overview with (security_invoker=true) as select p.*,coalesce(r.bytes,0) as bytes from public.inkstrip_cloud_projects p left join public.inkstrip_cloud_revisions r on r.project_id=p.id and r.revision=p.head_revision;
revoke all on public.inkstrip_cloud_project_overview from public,anon;
grant select on public.inkstrip_cloud_project_overview to authenticated,service_role;
create function public.inkstrip_schema_version() returns integer language sql as $$ select 1 $$;
create function public.inkstrip_consume_rate(p_key text,p_limit integer,p_seconds integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.inkstrip_rate_limits;
begin
 if p_limit<1 or p_limit>10000 or p_seconds<1 or p_seconds>86400 then raise exception 'Invalid rate window';end if;
 insert into public.inkstrip_rate_limits(key,ends_at,used) values(p_key,clock_timestamp()+make_interval(secs=>p_seconds),1)
 on conflict(key) do update set used=case when inkstrip_rate_limits.ends_at<=clock_timestamp() then 1 else inkstrip_rate_limits.used+1 end,
 ends_at=case when inkstrip_rate_limits.ends_at<=clock_timestamp() then clock_timestamp()+make_interval(secs=>p_seconds) else inkstrip_rate_limits.ends_at end returning * into r;
 return jsonb_build_object('allowed',r.used<=p_limit,'retry',greatest(1,ceil(extract(epoch from r.ends_at-clock_timestamp()))::integer));
end $$;
create function public.inkstrip_consume_action(p_hash text,p_kind text,p_user uuid,p_session text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.inkstrip_account_actions;
begin
 update public.inkstrip_account_actions set consumed_at=clock_timestamp() where id_hash=p_hash and kind=p_kind and consumed_at is null and expires_at>clock_timestamp()
 and (p_user is null or user_id=p_user) and (p_session is null or session_id=p_session) returning * into r;
 if r.id_hash is null then raise exception 'Action expired or already used';end if;
 return to_jsonb(r);
end $$;
create function public.inkstrip_open_project(p_owner uuid,p_local text,p_title text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.inkstrip_cloud_projects;
begin
 if not exists(select 1 from public.inkstrip_profiles where id=p_owner and deleting_at is null) then raise exception 'Account unavailable';end if;
 insert into public.inkstrip_cloud_projects(owner_id,local_id,title) values(p_owner,p_local,p_title) on conflict(owner_id,local_id) do nothing;
 select * into r from public.inkstrip_cloud_projects where owner_id=p_owner and local_id=p_local;
 return to_jsonb(r);
end $$;
create function public.inkstrip_commit_revision(p_owner uuid,p_project uuid,p_base integer,p_manifest jsonb,p_hash text,p_title text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.inkstrip_cloud_projects;part jsonb;total bigint:=0;latest_hash text;next_revision integer;
begin
 select * into p from public.inkstrip_cloud_projects where id=p_project and owner_id=p_owner for update;
 if p.id is null or not exists(select 1 from public.inkstrip_profiles where id=p_owner and deleting_at is null) then raise exception 'Project unavailable';end if;
 select manifest_hash into latest_hash from public.inkstrip_cloud_revisions where project_id=p.id and revision=p.head_revision;
 if latest_hash=p_hash then return jsonb_build_object('revision',p.head_revision,'duplicate',true);end if;
 if p.head_revision<>p_base then raise exception 'REVISION_CONFLICT';end if;
 if p_manifest is null or (p_manifest->>'version') is distinct from '1' or jsonb_typeof(p_manifest->'parts') is distinct from 'array' or (p_manifest->>'bytes') is null or jsonb_array_length(p_manifest->'parts') not between 1 and 1000 then raise exception 'Invalid manifest';end if;
 for part in select * from jsonb_array_elements(p_manifest->'parts') loop
 if not exists(select 1 from public.inkstrip_cloud_chunks where project_id=p.id and owner_id=p_owner and digest=part->>'digest' and bytes=(part->>'bytes')::integer) then raise exception 'Unverified project chunk';end if;
 total:=total+(part->>'bytes')::integer;
 end loop;
 if total<>(p_manifest->>'bytes')::bigint or total not between 1 and 2000000000 then raise exception 'Invalid package size';end if;
 next_revision:=p.head_revision+1;
 insert into public.inkstrip_cloud_revisions(project_id,owner_id,revision,manifest,manifest_hash,bytes) values(p.id,p_owner,next_revision,p_manifest,p_hash,total);
 update public.inkstrip_cloud_projects set head_revision=next_revision,title=p_title,updated_at=clock_timestamp() where id=p.id and owner_id=p_owner;
 return jsonb_build_object('revision',next_revision,'duplicate',false);
end $$;
revoke all on function public.inkstrip_schema_version(),public.inkstrip_consume_rate(text,integer,integer),public.inkstrip_consume_action(text,text,uuid,text),public.inkstrip_open_project(uuid,text,text),public.inkstrip_commit_revision(uuid,uuid,integer,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.inkstrip_schema_version(),public.inkstrip_consume_rate(text,integer,integer),public.inkstrip_consume_action(text,text,uuid,text),public.inkstrip_open_project(uuid,text,text),public.inkstrip_commit_revision(uuid,uuid,integer,jsonb,text,text) to service_role;
revoke all on function public.inkstrip_profile_from_auth() from public;
-- Private, immutable, owner/project-scoped content-addressed package parts.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inkstrip-private','inkstrip-private',false,2097152,array['application/octet-stream']) on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['application/octet-stream'];
create policy inkstrip_storage_read on storage.objects for select to authenticated using(bucket_id='inkstrip-private' and public.inkstrip_owns_path(name));
create policy inkstrip_storage_insert on storage.objects for insert to authenticated with check(bucket_id='inkstrip-private' and public.inkstrip_owns_path(name));
-- No authenticated UPDATE/DELETE: published parts cannot be replaced or removed.
commit;
