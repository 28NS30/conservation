-- English common names, beside the Chinese ones.
--
-- TaiCOL, where every row of `taxa` comes from, has no English name at all:
-- its /v2/taxon records carry `common_name_c` and `alternative_name_c` and
-- nothing else, and a TaiCOL search for "Leopard Cat" finds nothing. So the
-- English names come from the authority for each group instead — AviList
-- v2025b's Clements v2025 column for birds, MDD v2.5 for mammals, iNaturalist's
-- preferred English name for everything else, and the Catalogue of Life only
-- when it offers exactly one name. scripts/build-english-names.ts fetches them
-- into the committed scripts/english-names.json, and
-- scripts/import-english-names.ts applies that file and the team's overrides.
--
-- The columns mirror common_name_zh / alt_names_zh, so reading and searching
-- them is the same code with one more column.
--
--   common_name_en            the display name, or NULL. NULL is a real answer:
--                             a taxon no source names in English gets none,
--                             never a machine translation of the Chinese.
--   alt_names_en              other English names, for search: AviList's own
--                             spelling where Clements differs ("Rock Dove"
--                             beside "Rock Pigeon"), MDD's other names, and the
--                             name an override displaced.
--   common_name_en_source     where the name came from ('avilist-v2025b:
--                             clements-v2025', 'mdd-v2.5', 'inat-2026-09',
--                             'col-2026-09-11', 'curated'), so a reader of any
--                             single row can tell a curated decision from an
--                             import, and a future re-import can tell which
--                             rows a source owns.
--   common_name_en_inherited  true when a subspecies shows its species' name.
--                             No authority names Taiwan's subspecies in
--                             English, so 石虎 (P. b. euptilurus) says "Leopard
--                             Cat" because its species does. The flag lets the
--                             display say so rather than implying a name the
--                             subspecies does not have.
--
-- TaiCOL's upsert (scripts/import-taicol.ts) lists every column it writes and
-- these are not among them, so re-importing TaiCOL leaves the English names in
-- place. Keep it that way: if that upsert ever wrote these columns it would
-- blank them on every run.
--
-- Additive and safe to run twice. Adding a column with a constant default does
-- not rewrite the table (PostgreSQL 11+), so this is instant on 125k rows.
alter table taxa add column if not exists common_name_en           text;
alter table taxa add column if not exists alt_names_en             text[];
alter table taxa add column if not exists common_name_en_source    text;
alter table taxa add column if not exists common_name_en_inherited boolean not null default false;

-- Trigram index, built the way 0005 built taxa_sci_trgm and taxa_zh_trgm, and
-- relying on the pg_trgm that 0005 created. Unlike the two-character Chinese
-- queries 0005 describes, English queries are nearly always three characters
-- or more ("cat", "egret"), so this index does serve the `ilike` the species
-- search will run.
create index if not exists taxa_en_trgm
  on taxa using gin (common_name_en gin_trgm_ops);

-- NO GRANT, DELIBERATELY. The public reads `taxa` as `web_anon`, which holds a
-- table-level SELECT on it (0004) and passes the `taxa_public_read` RLS policy
-- (0013). A table-level grant covers columns added later, so these four are
-- readable exactly as widely as common_name_zh already is — and no wider.
-- `anon` and `authenticated` lost every table privilege in 0013 and must not
-- get one back here: nothing in this project reads through PostgREST.
--
-- The report_ai_suggestions view (0004) is left alone. Which surfaces show the
-- English name is the display half of this work, and a view that grows a
-- column nobody reads yet is a change nobody reviews.
