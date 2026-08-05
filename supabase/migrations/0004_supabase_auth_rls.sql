-- M2: Supabase auth, roles and row-level security.
--
-- Security posture, stated once because every policy below follows from it:
--
--   * The browser NEVER writes through PostgREST. If `anon` could insert into
--     `reports` directly, anyone could POST to /rest/v1/reports and bypass
--     Turnstile and rate limiting entirely. All writes go through our own route
--     handlers using the service role.
--   * Public reads go through the `web_anon` role, which can reach `reports_public`
--     and never the `reports` base table. Server code enters that role with
--     `set local role web_anon` (see apps/web/lib/db.ts), so even a careless
--     `select * from reports` in a public code path fails loudly.
--   * RLS is therefore defence in depth, not the only control. It is deny-by-default:
--     tables get RLS enabled and only the few genuinely needed policies.
--
-- Guarded with DO blocks so this file still runs on a plain PostGIS cluster that
-- has no `auth` or `storage` schema.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id           uuid primary key,
  display_name text,
  role         text not null default 'user' check (role in ('user','moderator','admin')),
  created_at   timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    -- Link profiles and report authorship to Supabase auth.
    begin
      alter table profiles
        add constraint profiles_user_fk foreign key (id) references auth.users(id) on delete cascade;
    exception when duplicate_object then null; end;

    begin
      alter table reports
        add constraint reports_reporter_fk foreign key (reporter_id) references auth.users(id) on delete set null;
    exception when duplicate_object then null; end;
  end if;
end $$;

-- Create a profile row automatically on signup.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function handle_new_user();
  end if;
end $$;

/** True when the caller is a moderator or admin. Used by policies below. */
create or replace function is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid
       and role in ('moderator','admin')
  )
$$;

-- ---------------------------------------------------------------------------
-- Public read surface
-- ---------------------------------------------------------------------------

-- AI suggestions for a report, exposed only for reports that are actually public.
create or replace view report_ai_suggestions as
  select c.report_id, c.rank, c.score, c.model_version,
         t.id as taxon_id, t.scientific_name, t.common_name_zh
    from classifications c
    join reports r on r.id = c.report_id
                  and r.status = 'published'
                  and r.location_precision <> 'suppressed'
    join taxa   t on t.id = c.taxon_id;

grant usage on schema public to web_anon;
grant select on reports_public, taxa, report_ai_suggestions to web_anon;
-- Deliberately NOT granted to web_anon: reports, report_photos, classifications,
-- classification_jobs, profiles, moderation_actions, rate_limits.

do $$
begin
  -- Supabase's built-in roles get the same public surface, in case anything
  -- reaches PostgREST. Note `reports` itself is never granted.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon, authenticated;
    grant select on reports_public, taxa, report_ai_suggestions to anon, authenticated;
  end if;
end $$;

-- The app connects as the migration-running role and drops to web_anon per
-- transaction via `set local role` (see asPublic() in apps/web/lib/db.ts).
-- SET ROLE requires membership, and Supabase's `postgres` is NOT a true
-- superuser, so grant it explicitly or every public read fails.
--
-- This is privilege *reduction*, not escalation: web_anon can do strictly less.
do $$
begin
  execute format('grant web_anon to %I', current_user);
end $$;

-- ---------------------------------------------------------------------------
-- RLS: deny by default, then the few policies we actually want
-- ---------------------------------------------------------------------------
alter table reports              enable row level security;
alter table report_photos        enable row level security;
alter table classifications      enable row level security;
alter table classification_jobs  enable row level security;
alter table profiles             enable row level security;
alter table moderation_actions   enable row level security;
alter table rate_limits          enable row level security;

-- The guard checks the `auth` schema, not just the role.
--
-- Roles are cluster-wide but schemas are per-database, so testing only for the
-- role is wrong on any Supabase cluster with a second database in it: the role
-- exists, the branch is taken, and every policy body below fails on the missing
-- auth.uid(). Checking both is what actually means "this database has Supabase
-- Auth in it", which is the real precondition.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and exists (select 1 from information_schema.schemata where schema_name = 'auth') then
    -- A signed-in reporter may read their own submissions, including the true
    -- coordinate — it is their own observation.
    drop policy if exists reports_select_own on reports;
    create policy reports_select_own on reports for select to authenticated
      using (reporter_id = auth.uid() or is_moderator());

    drop policy if exists report_photos_select_own on report_photos;
    create policy report_photos_select_own on report_photos for select to authenticated
      using (exists (select 1 from reports r
                      where r.id = report_photos.report_id
                        and (r.reporter_id = auth.uid() or is_moderator())));

    drop policy if exists profiles_select_own on profiles;
    create policy profiles_select_own on profiles for select to authenticated
      using (id = auth.uid() or is_moderator());

    drop policy if exists profiles_update_own on profiles;
    create policy profiles_update_own on profiles for update to authenticated
      using (id = auth.uid()) with check (id = auth.uid());
  end if;
end $$;
-- No INSERT/UPDATE/DELETE policies for anon or authenticated anywhere: every write
-- goes through our API on the service role, which bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('report-photos', 'report-photos', false, 10485760,
            array['image/webp','image/jpeg','image/png'])
    on conflict (id) do update
      set file_size_limit   = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
    -- Private bucket. Uploads happen via short-lived signed URLs minted server-side;
    -- reads via signed download URLs. No blanket anon policy on storage.objects.
  end if;
end $$;
