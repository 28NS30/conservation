-- Index the binomial lookups, and put back the search_path pins 0026 dropped.
--
-- binomial_precision() finds a taxon's siblings by binomial_of(scientific_name),
-- and nothing indexed that expression, so every call read the whole of taxa
-- (136,680 rows). 0025 made the record page call it for each of the model's
-- candidates, from inside a view the planner evaluates per candidate: 25 full
-- scans per page view. The first two public reports (30 September 2026) each
-- had five candidates, and their pages took 1.7 to 9.5 seconds in production,
-- against an 8-second limit on public queries (review of the security fixes,
-- 30 September 2026). With the index a lookup is a few milliseconds. The same
-- index makes 0026's re-blur on each new taxon cheap again: a TaiCOL refresh
-- had become about 0.1 s per inserted taxon.
--
-- The pins: 0014 and 0021 created reblur_reports_for_taxon() and
-- reblur_reports_for_floor() with `set search_path = public`, which is
-- load-bearing for a data-only restore (pg_dump clears search_path before COPY,
-- and these fire on COPY into taxa). 0026 re-created them without it.
--
-- tighten_binomial_siblings() is also re-written so the sibling ids are
-- computed once and the update finds its rows through reports' taxon index,
-- instead of reading every identified report on each call.
--
-- Safe to re-run.

set local lock_timeout = '5s';

create index if not exists taxa_binomial_idx on taxa (binomial_of(scientific_name));

create or replace function public.tighten_binomial_siblings(p_taxon_ids bigint[])
returns bigint
language plpgsql
set search_path = public
as $$
declare
  siblings bigint[];
  n bigint;
begin
  select coalesce(array_agg(distinct s.id), '{}')
    into siblings
    from taxa t
    join taxa s
      on binomial_of(s.scientific_name) = binomial_of(t.scientific_name)
     and (s.kingdom is null or t.kingdom is null or s.kingdom = t.kingdom)
   where t.id = any (p_taxon_ids);

  if cardinality(siblings) = 0 then
    return 0;
  end if;

  update reports r
     set precision_override = stricter_precision(r.precision_override,
                                                 binomial_precision(r.taxon_id))
   where r.taxon_id = any (siblings)
     and r.taxon_source in ('ai', 'user', 'expert')
     and precision_rank(binomial_precision(r.taxon_id))
         > precision_rank(r.location_precision);
  get diagnostics n = row_count;
  return n;
end
$$;

alter function public.reblur_reports_for_taxon() set search_path = public;
alter function public.reblur_reports_for_floor() set search_path = public;

-- Not a public endpoint (0024).
revoke execute on function public.tighten_binomial_siblings(bigint[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.tighten_binomial_siblings(bigint[]) from anon, authenticated;
  end if;
end $$;

analyze taxa;
