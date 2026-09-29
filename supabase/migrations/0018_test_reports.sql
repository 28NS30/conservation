-- Test reports: every step a real report takes, except being shown.
--
-- The site has never received a report from a person, so nothing from the form
-- onward (the upload, the challenge, the insert, the blur, the classifier, the
-- moderation queue, the receipt) has run in production on real input. The only
-- way to try it was to file a real report, which then sat on the public map,
-- in /stats, in the export and in the species counts, and opened the season
-- page (lib/coverage.ts) on the strength of a test.
--
-- A test report is an ordinary report with is_test set. It goes everywhere a
-- real one goes except the last step: reports_public leaves it out, and every
-- public surface reads that view. That covers the map's tiles, the record list
-- and record page, species pages and species_report_stats, /stats, the three
-- collections, the season gate and the Darwin Core export. The moderation
-- queue, the receipt and /me read `reports` itself, so they still show it,
-- marked as a test.
--
-- Only a moderator or an admin can file one: app/api/reports/route.ts reads the
-- role from `profiles`. A request from anyone else that asks for a test report
-- is refused, never published as a real one. Nothing ever changes is_test after
-- the insert, so a test report has never been in reports_public, and a real
-- one never leaves it by being relabelled.
--
-- TWO VIEWS, ONE SET OF RULES. The moderator who filed a test needs to see what
-- the public would have seen: where the blur put it, what the classifier said.
-- So the rules that decide what the public sees (published, not suppressed,
-- which columns, the invasive flag) move to `reports_published`, which keeps
-- test reports, and reports_public becomes that view minus them. A second copy
-- of the rules for moderators would drift from the first, and the blur has
-- been missed twice before by exactly that kind of drift.
--
-- `reports_published` is read by the server's own connection only. Nothing is
-- granted on it; 0013 removed the default grants to anon and authenticated,
-- and the revokes below say so again in case a database still has them.
-- web_anon keeps reading reports_public alone, whose owner reads
-- reports_published on its behalf, as any view does.
--
-- report_ai_suggestions is left as it is. It answers by report id only, the
-- record page reads it only after finding the record, and the REST API that
-- could otherwise reach it by id is closed (0013).
--
-- Additive. `not null default false` is a metadata change since Postgres 11,
-- with no rewrite of the table. reports_public is `create or replace`, never
-- drop, because species_report_stats selects from it: the same columns in the
-- same order as 0016. Safe to re-run.

set local lock_timeout = '5s';

alter table reports add column if not exists is_test boolean not null default false;

comment on column reports.is_test is
  'Filed by a moderator to try the pipeline. Takes every step a real report takes; reports_public leaves it out, so it is never shown publicly.';

create or replace view reports_published as
  select id,
         category,
         geom_3857,
         location_public,
         location_precision,
         is_obscured,
         observed_at,
         notes,
         taxon_id,
         taxon_source,
         verbatim_name,
         ai_confidence,
         source,
         license,
         rights_holder,
         created_at,
         case when location_precision = 'exact' then location_accuracy_m end
           as location_accuracy_m,
         case
           when taxon_id is not null then
             taxon_id in (select t.id
                            from public.taxa t
                           where t.is_invasive
                             and t.kingdom = 'Animalia'
                             and t.taxon_status = 'accepted')
           else category = 'invasive'
         end as is_invasive,
         is_test
    from reports
   where status = 'published'
     and location_precision <> 'suppressed';

comment on view reports_published is
  'What the public sees of each report, test reports included. The server reads it; nobody is granted it. reports_public is this minus is_test.';

revoke all on reports_published from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'web_anon') then
    revoke all on reports_published from web_anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on reports_published from anon, authenticated;
  end if;
end $$;

create or replace view reports_public as
  select id,
         category,
         geom_3857,
         location_public,
         location_precision,
         is_obscured,
         observed_at,
         notes,
         taxon_id,
         taxon_source,
         verbatim_name,
         ai_confidence,
         source,
         license,
         rights_holder,
         created_at,
         location_accuracy_m,
         is_invasive
    from reports_published
   where not is_test;

comment on column reports_public.is_invasive is
  'In the invasive collection: the species is an animal TaiCOL tags invasive, under a name TaiCOL accepts, or the record has no species and was filed as invasive. Read from taxa at query time; never stored on the report.';
