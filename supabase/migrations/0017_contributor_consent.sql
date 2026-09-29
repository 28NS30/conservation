-- What a reporter agreed to, stored with each report.
--
-- Nothing asked reporters how their photos and records may be used, yet the
-- export once labelled them CC BY 4.0 (PR #77 stopped that). From here each
-- report carries the answer, per report because reports need no account and
-- the terms will change over time, and with the version of /terms it was
-- given under, because Taiwan's Personal Data Protection Act asks consent to
-- be a recorded, separate declaration (Art. 7).
--
--   license, rights_holder  already exist: the licence's legalcode URL and the
--                           name to credit, the shape GBIF's imports use.
--   share_partners          the separate, unticked box on the roadkill page:
--                           share this record, exact location included, with
--                           research partners (TaiRON). Nothing is sent until
--                           TaiRON agrees to a channel; this only records who
--                           said yes.
--   consent_version         the /terms version (CONSENT_VERSION in
--   consent_at              packages/shared) and when it was given.
--
-- Not in reports_public: whether someone agreed to share with a partner is
-- nobody else's business. The view lists its columns, so a new column stays
-- out of it until someone adds it there.
--
-- Additive. `not null default false` is a metadata change since Postgres 11,
-- with no rewrite of the table.

set local lock_timeout = '5s';

alter table reports add column if not exists share_partners boolean not null default false;
alter table reports add column if not exists consent_version text;
alter table reports add column if not exists consent_at timestamptz;
