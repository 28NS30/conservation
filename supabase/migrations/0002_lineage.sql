-- Post-import maintenance: materialise taxonomic lineage and build BioCLIP prompts.
--
-- TaiCOL exposes only `kingdom` plus `parent_taxon_id`, so the full lineage has to
-- be walked up the parent chain. Run this after scripts/import-taicol.ts.

create or replace function resolve_taxa_lineage() returns bigint
language plpgsql set search_path = public as $$
declare
  n bigint;
begin
  with recursive lineage as (
    -- Seed: every taxon is its own ancestor at depth 0.
    select t.id as root_id, t.taicol_id, t.parent_taicol_id,
           t.rank, t.scientific_name, 0 as depth
    from taxa t
    union all
    -- Climb one level toward the root.
    select l.root_id, p.taicol_id, p.parent_taicol_id,
           p.rank, p.scientific_name, l.depth + 1
    from lineage l
    join taxa p on p.taicol_id = l.parent_taicol_id
    where l.depth < 40                      -- guard against a cycle in the source data
  ),
  agg as (
    select root_id,
      max(scientific_name) filter (where rank = 'Kingdom') as kingdom,
      max(scientific_name) filter (where rank = 'Phylum')  as phylum,
      max(scientific_name) filter (where rank = 'Class')   as class,
      max(scientific_name) filter (where rank = 'Order')   as ord,
      max(scientific_name) filter (where rank = 'Family')  as family,
      max(scientific_name) filter (where rank = 'Genus')   as genus
    from lineage
    group by root_id
  )
  update taxa t
     set kingdom = a.kingdom, phylum = a.phylum, class = a.class,
         "order" = a.ord,     family = a.family, genus  = a.genus
    from agg a
   where t.id = a.root_id;

  get diagnostics n = row_count;

  -- BioCLIP was trained on taxonomic hierarchy strings, so the text side must be
  -- the lineage — not a bare or colloquial name. `scientific_name` already carries
  -- "Genus species", so genus is not repeated.
  --
  -- Chinese vernaculars are deliberately excluded: CLIP's text encoder is
  -- English-trained and they would add noise. They remain for display only.
  update taxa
     set bioclip_prompt = 'a photo of '
         || nullif(concat_ws(' ', kingdom, phylum, class, "order", family), '')
         || ' ' || scientific_name || '.'
   where rank in ('Species','Subspecies','Variety','Form')
     and is_in_taiwan;

  return n;
end $$;

comment on function resolve_taxa_lineage is
  'Walks parent_taicol_id to fill kingdom..genus, then builds bioclip_prompt for Taiwan species. Run after import-taicol.';
