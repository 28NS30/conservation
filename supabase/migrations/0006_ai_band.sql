-- Record which confidence band the classifier landed in, and stop showing a
-- suggestion list that the measurement says is mostly wrong.
--
-- Until now the band was computed in apps/ml/pipeline.py and then discarded: the
-- worker branched only on 'high' (auto-assign) and every other report had all
-- five predictions stored and surfaced identically. So a report the model was
-- barely guessing at offered the reporter the same confident-looking list as one
-- it nearly got right.
--
-- That matters because of what the list does. In the medium band it is genuinely
-- useful — measured local top-5 is 91.6%, so the right answer is nearly always
-- there. Below BAND_MEDIUM (0.28) local top-5 falls to 68%, and a list that is
-- wrong a third of the time does not merely waste the reporter's time, it anchors
-- them on a plausible-looking wrong species. A citizen-science dataset's value is
-- its accuracy; a confidently-presented bad guess is worse than no guess.
--
-- The classifications rows are still written for every band. They are the record
-- of what the model actually said, which is what makes comparing model versions
-- possible. This only governs what is shown.

alter table reports
  add column if not exists ai_band text
    check (ai_band in ('high', 'medium', 'low'));

comment on column reports.ai_band is
  'Confidence band from the classifier. See BAND_HIGH / BAND_MEDIUM in apps/ml/pipeline.py, both fitted against the eval set.';

-- Partial: only the low band is ever selected on, and it is the small minority.
create index if not exists reports_ai_band_low
  on reports (ai_band) where ai_band = 'low';

-- Suggestions are withheld in the low band. `is distinct from` rather than <>
-- because ai_band is null for every report that predates this migration and for
-- every non-classifiable category — those must keep behaving as before.
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
    join taxa t on t.id = c.taxon_id;

grant select on report_ai_suggestions to web_anon;
