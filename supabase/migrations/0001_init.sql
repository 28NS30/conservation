-- Conservation platform — core schema.
--
-- Portable between plain Postgres+PostGIS (local docker) and Supabase.
-- Supabase note: reporter_id is an unconstrained uuid here so this file runs on a
-- vanilla cluster. On Supabase, add:
--     alter table reports add constraint reports_reporter_fk
--       foreign key (reporter_id) references auth.users(id) on delete set null;

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- taxa — the Taiwan species checklist, loaded from the TaiCOL API
-- (https://api.taicol.tw/v2/taxon — keyless, ~125k taxa, ~66k Taiwan species).
--
-- TaiCOL returns only `kingdom` plus `parent_taxon_id`; the rest of the lineage
-- is a linked list. The rank columns below are therefore populated by walking
-- parent_taxon_id after import (see resolve_taxa_lineage()).
-- ---------------------------------------------------------------------------
create table taxa (
  id               bigserial primary key,
  taicol_id        text unique not null,          -- e.g. 't0032116'
  parent_taicol_id text,
  taxon_status     text,                          -- accepted | not-accepted | misapplied
  scientific_name  text not null,                 -- TaiCOL `simple_name`
  name_author      text,
  common_name_zh   text,                          -- `common_name_c`
  alt_names_zh     text[],                        -- `alternative_name_c`, split on comma
  rank             text,

  -- Lineage, materialised from the parent walk.
  kingdom text, phylum text, class text, "order" text, family text, genus text,

  is_in_taiwan     boolean not null default false,
  is_endemic       boolean not null default false, -- 特有種
  alien_type       text,                           -- native | naturalized | invasive | cultured | ...
  is_invasive      boolean not null default false, -- derived from alien_type

  -- Conservation / disclosure status.
  protected_status text,   -- 保育等級: I / II / III  (null = not protected)
  cites            text,
  iucn             text,
  redlist          text,   -- Taiwan national red list
  sensitivity      text,   -- 敏感度: 輕度 | 重度 | 縣市 | 座標不開放  (null = not sensitive)

  -- Habitat flags, usable later to narrow BioCLIP candidates by context.
  is_terrestrial boolean, is_freshwater boolean, is_brackish boolean, is_marine boolean,

  -- Taxonomic string fed to BioCLIP's text encoder. BioCLIP was trained on full
  -- hierarchy strings, so this is built from the lineage rather than a bare name.
  bioclip_prompt   text,
  embedding_row    int,                            -- row index into taxa_embeddings.npy

  updated_at       timestamptz
);

create index on taxa (lower(scientific_name));
create index on taxa (parent_taicol_id);
create index on taxa (protected_status) where protected_status is not null;
create index on taxa (sensitivity)      where sensitivity      is not null;
create index on taxa (is_invasive)      where is_invasive;
create index on taxa (rank, is_in_taiwan);

-- ---------------------------------------------------------------------------
-- Location disclosure policy.
--
-- Publishing precise locations of sensitive taxa enables poaching and collection.
-- TaiCOL ships an authoritative per-taxon sensitivity rating (敏感度) that exists
-- for exactly this purpose; we honour it, and fall back to protection status for
-- protected taxa that carry no explicit rating.
--
-- Returns the grid cell size in degrees, or NULL meaning "never publish a
-- coordinate for this taxon".
-- ---------------------------------------------------------------------------
create or replace function sensitivity_cell_deg(sens text, prot text)
returns double precision
language sql immutable as $$
  select case
    when sens = '座標不開放'      then null   -- coordinates withheld entirely
    when sens in ('重度','縣市')  then 0.5    -- ~50km, county resolution
    when sens = '輕度'            then 0.1    -- ~10km
    when prot is not null and prot <> '' then 0.1  -- protected but unrated -> default 10km
    else 0                                     -- exact
  end
$$;

-- Deterministic obscuring. MUST be deterministic for a given report: re-randomising
-- per read would let anyone average repeated requests back to the true coordinate.
-- Snaps to a cell, then offsets deterministically within it by a hash of the report id.
create or replace function obscure_point(
  pt       geography,
  seed     uuid,
  cell_deg double precision
) returns geography
language plpgsql immutable strict as $$
declare
  lon double precision := st_x(pt::geometry);
  lat double precision := st_y(pt::geometry);
  jx  double precision;
  jy  double precision;
begin
  -- bit(24)::int is always non-negative, which bit(32)::bigint is not.
  jx := ('x' || substr(md5(seed::text || ':x'), 1, 6))::bit(24)::int / 16777216.0;
  jy := ('x' || substr(md5(seed::text || ':y'), 1, 6))::bit(24)::int / 16777216.0;

  return st_setsrid(
    st_makepoint(
      floor(lon / cell_deg) * cell_deg + jx * cell_deg,
      floor(lat / cell_deg) * cell_deg + jy * cell_deg
    ), 4326
  )::geography;
end $$;

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
create table reports (
  id              uuid primary key default gen_random_uuid(),
  category        text not null
                  check (category in ('roadkill','invasive','pollution','injured','habitat','sighting')),

  -- TRUE location. Never exposed publicly — see the reports_public view below.
  location        geography(Point,4326) not null,
  -- What the public may see. Equal to location for ordinary taxa.
  location_public geography(Point,4326) not null,
  location_precision text not null default 'exact'
                  check (location_precision in ('exact','coarse_10km','coarse_50km','suppressed')),

  observed_at     timestamptz not null,
  notes           text,

  taxon_id        bigint references taxa(id) on delete set null,
  taxon_source    text check (taxon_source in ('ai','user','expert','imported')),
  verbatim_name   text,               -- source name when it didn't match our checklist
  ai_confidence   real,

  status          text not null default 'published'
                  check (status in ('pending','published','rejected')),

  source          text not null default 'user' check (source in ('user','gbif')),
  source_id       text,               -- external id, for idempotent re-import
  license         text,               -- GBIF records carry per-record licences
  rights_holder   text,

  reporter_id     uuid,               -- null = anonymous submission
  created_at      timestamptz not null default now()
);

alter table reports
  add column is_obscured boolean
    generated always as (location_precision <> 'exact') stored,
  -- Web-Mercator projection of the PUBLIC point, stored + indexed so tile requests
  -- never transform on the fly (the difference between ~20ms and ~2s per tile).
  add column geom_3857 geometry(Point,3857)
    generated always as (st_transform(location_public::geometry, 3857)) stored;

create unique index reports_source_uidx on reports (source, source_id) where source_id is not null;
create index reports_geom_gix      on reports using gist (geom_3857);
create index reports_category_time on reports (category, observed_at desc);
create index reports_taxon         on reports (taxon_id) where taxon_id is not null;
create index reports_status        on reports (status);

create or replace function set_report_public_location() returns trigger
language plpgsql as $$
declare
  sens text; prot text; cell double precision;
begin
  if new.taxon_id is null then
    cell := 0;
  else
    select sensitivity, protected_status into sens, prot from taxa where id = new.taxon_id;
    cell := sensitivity_cell_deg(sens, prot);
  end if;

  if cell is null then
    -- Coordinates withheld entirely. A coarse point is still stored so the column
    -- stays NOT NULL, but reports_public excludes these rows outright.
    new.location_precision := 'suppressed';
    new.location_public    := obscure_point(new.location, new.id, 1.0);
  elsif cell = 0 then
    new.location_precision := 'exact';
    new.location_public    := new.location;
  else
    new.location_precision := case when cell >= 0.5 then 'coarse_50km' else 'coarse_10km' end;
    new.location_public    := obscure_point(new.location, new.id, cell);
  end if;
  return new;
end $$;

create trigger reports_set_public_location
  before insert or update of location, taxon_id on reports
  for each row execute function set_report_public_location();

-- ---------------------------------------------------------------------------
-- photos, classifications, job queue
-- ---------------------------------------------------------------------------
create table report_photos (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references reports(id) on delete cascade,
  storage_path text not null,
  width int, height int,
  created_at   timestamptz not null default now()
);
create index on report_photos (report_id);

-- Top-k retained rather than just the winner: the UI offers alternatives to the
-- user, and keeping full output lets us evaluate and re-score as the model improves.
create table classifications (
  id            bigserial primary key,
  report_id     uuid not null references reports(id) on delete cascade,
  taxon_id      bigint references taxa(id) on delete set null,
  score         real not null,
  rank          int  not null,
  model_version text not null,
  created_at    timestamptz not null default now()
);
create index on classifications (report_id, rank);

create table classification_jobs (
  id         bigserial primary key,
  report_id  uuid not null references reports(id) on delete cascade,
  status     text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts   int  not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index classification_jobs_queue on classification_jobs (status, created_at)
  where status in ('queued','failed');

-- ---------------------------------------------------------------------------
-- Public exposure.
--
-- Anonymous clients get a VIEW, never the base table. This is structural: there
-- is no column-level grant to forget and no `select *` that can leak a true
-- coordinate for a sensitive species.
-- ---------------------------------------------------------------------------
create view reports_public as
  select
    id, category, geom_3857, location_public, location_precision, is_obscured,
    observed_at, notes, taxon_id, taxon_source, verbatim_name,
    ai_confidence, source, license, rights_holder, created_at
  from reports
  where status = 'published'
    and location_precision <> 'suppressed';

-- A least-privilege role the web app connects as. Supabase already ships `anon`
-- and `authenticated`; creating web_anon keeps local dev honest so the "can the
-- public reach the true location?" test is actually runnable here.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'web_anon') then
    create role web_anon nologin;
  end if;
end $$;

grant usage on schema public to web_anon;
grant select on reports_public to web_anon;
grant select on taxa to web_anon;
-- Deliberately NOT granted: reports, report_photos, classification_jobs.
