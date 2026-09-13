-- Retire `pollution` and `habitat` as report categories.
--
-- The team's reporting flow is now three choices — invasive species, wildlife
-- sighting, and roadkill or injured — so these two can no longer be submitted.
-- Neither has ever held a report (every one of the 46,334 rows is an imported
-- roadkill record), so there is nothing to migrate and nothing to lose.
--
-- The constraint is narrowed rather than left permissive on purpose. A CHECK
-- wider than the application's own type is how a row appears that no page knows
-- how to render: CATEGORIES in packages/shared drives the colour, the label and
-- the filters, and a value outside it reaches the UI as undefined.
--
-- If this fails with a check-violation, a report in one of these categories
-- exists after all. Decide where it belongs before forcing it through.
alter table reports drop constraint if exists reports_category_check;

alter table reports
  add constraint reports_category_check
  check (category in ('roadkill', 'invasive', 'injured', 'sighting'));
