-- How good the fix was, when the device was the one that took it.
--
-- Asked for by name in the team's field list, and it is the difference between
-- a 20 m reading under open sky and a 2 km one in a valley: a record whose
-- coordinate cannot be trusted to a kilometre is a different record, and today
-- nothing distinguishes the two.
--
-- Only ever set from `navigator.geolocation`. A pin the reporter dragged onto a
-- map, or a coordinate read out of a photograph's EXIF, has no accuracy to
-- report, and attaching a number to either would be inventing a measurement.
alter table reports add column if not exists location_accuracy_m integer;

alter table reports drop constraint if exists reports_accuracy_sane;

-- A negative radius is meaningless and a 100 km one says nothing that a null
-- does not. Both are rejected rather than stored and reasoned about later.
alter table reports
  add constraint reports_accuracy_sane
  check (location_accuracy_m is null
         or (location_accuracy_m >= 0 and location_accuracy_m <= 100000));

-- Published only alongside an exact coordinate.
--
-- The obscuring stack moves a sensitive species' point by up to 50 km. Printing
-- "±12 m" beside that point would publish the fact that the true coordinate was
-- measured to within twelve metres — which is not the location, but it is a
-- statement about the location that the blur exists to avoid making. Where the
-- point is not exact, this column reads null in public.
--
-- `create or replace`, never `drop cascade`: species_report_stats selects from
-- this view. Column order and names are preserved and the new column appended,
-- which is what `replace` requires.
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
         case when location_precision = 'exact' then location_accuracy_m end
           as location_accuracy_m
    from reports
   where status = 'published'
     and location_precision <> 'suppressed';
