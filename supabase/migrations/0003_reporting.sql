-- M2: user-submitted reports.
--
-- Also reworks the location-precision logic. M1 derived precision purely from the
-- report's taxon, which is correct once a species is known — but an AI-classified
-- report has NO taxon at submission time. Publishing it immediately would put a
-- 石虎 (leopard cat) on the public map at its exact coordinate until the classifier
-- caught up, which is exactly the disclosure the obscuring design exists to prevent.
--
-- Two changes close that hole:
--   1. `precision_override`, which can only ever make a location *coarser*.
--   2. Classifiable reports are inserted as `pending` and published by the
--      classification worker (application logic, see apps/web/app/api/reports).

-- ---------------------------------------------------------------------------
-- Precision as an ordered scale, so "most conservative wins" is expressible.
-- ---------------------------------------------------------------------------
create or replace function precision_rank(p text) returns int
language sql immutable as $$
  select case p
    when 'exact'       then 0
    when 'coarse_10km' then 1
    when 'coarse_50km' then 2
    when 'suppressed'  then 3
    else 0
  end
$$;

/** Grid cell size in degrees for a given precision level. */
create or replace function precision_cell_deg(p text) returns double precision
language sql immutable as $$
  select case p
    when 'coarse_10km' then 0.1     -- ~10km
    when 'coarse_50km' then 0.5     -- ~50km, county resolution
    when 'suppressed'  then 1.0     -- stored coarsely; the view excludes it anyway
    else 0
  end
$$;

/**
 * Disclosure policy for a taxon, from TaiCOL's sensitivity rating (敏感度),
 * falling back to protection status for protected taxa with no explicit rating.
 */
create or replace function precision_from_taxon(sens text, prot text) returns text
language sql immutable as $$
  select case
    when sens = '座標不開放'      then 'suppressed'
    when sens in ('重度','縣市')  then 'coarse_50km'
    when sens = '輕度'            then 'coarse_10km'
    when prot is not null and prot <> '' then 'coarse_10km'
    else 'exact'
  end
$$;

alter table reports
  -- Set by the submission path (unidentified reports default to coarse) and by the
  -- classification worker's give-up path. Can only tighten, never loosen.
  add column if not exists precision_override text
    check (precision_override in ('exact','coarse_10km','coarse_50km','suppressed'));

-- `set search_path = public` is load-bearing, not decoration: pg_dump emits
-- `set_config('search_path', '', false)` before COPY, so an unqualified `taxa`
-- reference in this trigger fails during any data restore.
create or replace function set_report_public_location() returns trigger
language plpgsql set search_path = public as $$
declare
  sens text; prot text; p_taxon text; p text;
begin
  if new.taxon_id is not null then
    select sensitivity, protected_status into sens, prot from public.taxa where id = new.taxon_id;
  end if;

  p_taxon := precision_from_taxon(sens, prot);

  -- Most conservative of (taxon policy, explicit override) wins. An override can
  -- never reveal a location that the taxon's own policy would have hidden.
  if precision_rank(coalesce(new.precision_override, 'exact')) > precision_rank(p_taxon) then
    p := new.precision_override;
  else
    p := p_taxon;
  end if;

  new.location_precision := p;
  new.location_public := case
    when p = 'exact' then new.location
    else obscure_point(new.location, new.id, precision_cell_deg(p))
  end;
  return new;
end $$;

drop trigger if exists reports_set_public_location on reports;
create trigger reports_set_public_location
  before insert or update of location, taxon_id, precision_override on reports
  for each row execute function set_report_public_location();

-- sensitivity_cell_deg() is superseded by precision_from_taxon + precision_cell_deg.
drop function if exists sensitivity_cell_deg(text, text);

-- ---------------------------------------------------------------------------
-- Submission-related columns
-- ---------------------------------------------------------------------------
alter table reports
  add column if not exists contact_email  text,   -- optional, for follow-up only
  add column if not exists flagged_reason text,   -- why it was held in `pending`
  add column if not exists client_nonce   text;   -- idempotency for double-tap / offline retry

create unique index if not exists reports_client_nonce_uidx
  on reports (client_nonce) where client_nonce is not null;

alter table report_photos
  add column if not exists bytes        int,
  add column if not exists content_type text;

-- ---------------------------------------------------------------------------
-- Moderation + rate limiting
-- ---------------------------------------------------------------------------
create table if not exists moderation_actions (
  id         bigserial primary key,
  report_id  uuid not null references reports(id) on delete cascade,
  actor_id   uuid,
  action     text not null check (action in ('publish','reject','retaxon','delete','flag')),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_report on moderation_actions (report_id, created_at desc);

-- Postgres rather than Redis: one datastore, and this volume never justifies another service.
create table if not exists rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window on rate_limits (window_start);

/** Increment a fixed-window counter and report whether the caller is over budget. */
create or replace function bump_rate_limit(k text, window_seconds int, budget int)
returns boolean language plpgsql as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  c int;
begin
  insert into rate_limits (key, window_start, count) values (k, w, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count into c;
  return c <= budget;
end $$;
