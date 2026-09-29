-- A blurred record says no more than its blur allows.
--
-- Two public surfaces could name what the coordinate blur hides.
--
-- NOTES. reports_published (and so reports_public, the record page, the map's
-- panel and GET /api/reports/[id]) published a report's free-text notes on
-- every record, including records of protected species held at 10 or 50 km.
-- A reporter's own words ("by the 23 km marker on 台21", "behind the temple
-- in 大雪山") are the one thing the coordinate blur cannot reach. The Darwin
-- Core export already leaves notes out for exactly that reason
-- (scripts/dwc-occurrences.ts). Now the view publishes notes only on records
-- shown at their exact location, the rule 0010 already applies to
-- location_accuracy_m. A moderator still reads them in the queue.
--
-- SUGGESTIONS. report_ai_suggestions listed the model's candidates for any
-- published record, whatever the record's blur. suggestionOverride blurs an
-- unidentified record at least as hard as its strictest candidate, but a record
-- can be named later (by its reporter, a moderator or the model) and take the
-- named species' looser rule, and the list kept naming the stricter candidate
-- beside the new, closer point. Now the whole list is withheld whenever any
-- candidate would need a stricter blur than the record has: a list with just
-- that row missing would still say what was removed.
--
-- The check has to read the precision floors, which web_anon may not, so it
-- is one SECURITY DEFINER function that answers yes or no about one report,
-- with a pinned search_path, executable by web_anon alone (0024 keeps it off
-- the REST API).
--
-- Both views are `create or replace` with the same columns in the same order:
-- species_report_stats depends on reports_public, and the grants stay. Safe to
-- re-run.

set local lock_timeout = '5s';

create or replace function public.suggestions_within_blur(p_report uuid, p_precision text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
      from classifications c
     where c.report_id = p_report
       and precision_rank(binomial_precision(c.taxon_id)) > precision_rank(p_precision))
$$;

comment on function public.suggestions_within_blur(uuid, text) is
  'Whether every model candidate for a report is blurred no more strictly than the report itself. report_ai_suggestions withholds the list when not.';

revoke execute on function public.suggestions_within_blur(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.suggestions_within_blur(uuid, text) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'web_anon') then
    grant execute on function public.suggestions_within_blur(uuid, text) to web_anon;
  end if;
end $$;

create or replace view reports_published as
  select id,
         category,
         geom_3857,
         location_public,
         location_precision,
         is_obscured,
         observed_at,
         case when location_precision = 'exact' then notes end as notes,
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

create or replace view report_ai_suggestions as
  select c.report_id,
         c.rank,
         c.score,
         c.model_version,
         t.id as taxon_id,
         t.scientific_name,
         t.common_name_zh
    from classifications c
    join reports r
      on r.id = c.report_id
     and r.status = 'published'
     and r.location_precision <> 'suppressed'
     and r.ai_band is distinct from 'low'
     -- A test report's page is a moderator's, never the public's (0018).
     and not r.is_test
     and suggestions_within_blur(r.id, r.location_precision)
    join taxa t on t.id = c.taxon_id;
