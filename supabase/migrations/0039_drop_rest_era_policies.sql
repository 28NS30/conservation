-- The row-level-security policies left from when the REST API was open.
--
-- 0004 wrote four policies for PostgREST, all for the `authenticated` role and
-- keyed on auth.uid(): through /rest/v1 a signed-in reporter could read their
-- own reports, those reports' photos and their own profile, and update their
-- own profile. 0013 closed the REST API by revoking every grant `anon` and
-- `authenticated` held on the tables in `public`, and nothing here has spoken
-- to PostgREST since: the site reads and writes through postgres.js
-- (apps/web/lib/db.ts), as `postgres`, which owns these tables and so is not
-- held by their policies, for its own work, and as `web_anon`, which no policy
-- here names, for what a visitor sees. So the four have guarded nothing since
-- 0013. One of them would do harm the day a grant came back:
--
--   profiles_update_own lets a signed-in user update their own profile row,
--   and it says nothing about which columns. `role` is one of them. Give
--   `authenticated` UPDATE on profiles again, by a click in the dashboard or a
--   migration that grants broadly, and anyone signed in could make themselves
--   an admin with one PATCH to /rest/v1/profiles. An admin reads every
--   record's exact point.
--
-- So they are dropped, and these tables keep row-level security on with no
-- policy at all: closed to every role but their owner, whatever is granted.
-- That is how every table since 0019 has been made (0019, 0036).
--
-- Dropped: profiles_select_own, profiles_update_own, reports_select_own and
-- report_photos_select_own. Production held exactly these four, and taxa's,
-- read on 26 October 2026 (pg_policies, names and tables only); storage held
-- none. CI's database never had them: it has no `auth` schema, so 0004 skipped
-- them, and CI has run the suite on tables with no policy all along.
--
-- KEPT: taxa_public_read (0013), which is not from the REST era. It is the
-- policy `web_anon` reads taxa through, on every species page, the directory
-- and the map's popups, and without it RLS on taxa leaves those empty
-- (apps/web/test/rest-api-closed.test.mjs).
--
-- is_moderator() is left in place. The dropped policies were its only callers
-- in SQL; it reads PostgREST's request.jwt.claims, which nothing sets any more,
-- and nobody but its owner may execute it (0024). The site decides who is a
-- moderator from profiles.role on its own connection (apps/web/lib/auth.ts).
--
-- Idempotent: `drop policy if exists`, and RLS is enabled again, which changes
-- nothing on a table where it is already on.

set local lock_timeout = '5s';

drop policy if exists profiles_select_own on profiles;
drop policy if exists profiles_update_own on profiles;
drop policy if exists reports_select_own on reports;
drop policy if exists report_photos_select_own on report_photos;

alter table profiles      enable row level security;
alter table reports       enable row level security;
alter table report_photos enable row level security;
