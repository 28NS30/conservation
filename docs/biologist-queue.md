# Identifications waiting for a biologist

These are the imported records whose name only a person who knows the animals
can settle. Each section gives the numbers from production, the choice to make,
and the SQL that carries it out once it is made, so that a decision takes
minutes. Counts are from **25 October 2026**.

Nothing here has been applied. The hoopoe was on this list until 0037 moved its
13 records to the species 戴勝: the subspecies was uncertain, but the species
was not.

## 日本樹蛙 *Buergeria japonica*: 75 records

TaiCOL does not record *B. japonica* in Taiwan (t0101610, `is_in_taiwan`
false). Taiwan's stream treefrogs are now two species:

| TaiCOL id | Name | Rule |
|---|---|---|
| t0029971 | 周氏樹蛙 *Buergeria choui* | exact |
| t0104460 | 太田樹蛙 *Buergeria otai* | exact |

All 75 records are exact, and both candidates are unprotected, unrated and
unfloored, so **either choice changes no blur**. The species page says "name
under review" until they move.

Where the 75 are:

| Band | Records |
|---|---|
| north of 24.6°N (all west of 121.2°E) | 10 |
| 24.0–24.6°N | 9 |
| south of 24.0°N, east of 121.0°E | 23 |
| south of 24.0°N, west of 121.0°E | 33 |

**The decision:** which species lives where, and so which records go to which
name. If the line is a latitude, the template below takes it as one number.
Run the same update twice with the two conditions. Records that fall in a zone
where both occur can stay on *B. japonica* and keep the "under review" note.

```sql
-- 0038_buergeria_split.sql: the biologist's line, at :LAT degrees north.
set local lock_timeout = '5s';

update reports r
   set taxon_id = dst.id,
       precision_override = case
         when r.location_precision = 'exact' then r.precision_override
         else stricter_precision(r.precision_override, r.location_precision)
       end
  from taxa src, taxa dst
 where src.taicol_id = 't0101610'                 -- Buergeria japonica
   and dst.taicol_id = 't0029971'                 -- 周氏樹蛙, or t0104460 太田樹蛙
   and r.taxon_id = src.id
   and r.source = 'gbif'
   and coalesce(r.taxon_source, 'imported') not in ('expert', 'user')
   and st_y(r.location::geometry) >= :LAT;        -- or < :LAT for the other species
```

After it: drop t0101610 from `apps/web/lib/speciesNotes.ts` if no records are
left on it. Add the migration's moves to `apps/web/test/species-labels.test.mjs`,
which runs it in a rolled-back transaction and checks that nothing loosens.
Dry-run on production first with a self-aborting `do` block, as for 0037.

## 50 records with a real name but no taxon

These were imported with a binomial that TaiCOL could not settle, so they have
no `taxon_id` and are blurred to 10 km, the rule for unnamed records. **Naming
any of them makes them exact**, because every candidate below is unprotected.
That is a loosening, and the blur policy (decided 30 September) leaves it to
the owner. So they need two decisions: the biologist's on the name, then the
owner's on publishing the records exactly.

| Published name | Records | Candidate | Why it is open |
|---|---|---|---|
| *Candidiopotamon rathbunae* | 29 | 拉氏明溪蟹 *C. rathbuni* t0077372, or 蓬萊明溪蟹 *C. penglai* t0102069 | Spelled *rathbunae*; TaiCOL returned both species for it. Which one each record is may depend on where it was found, as for the treefrog. |
| *Turdus merula* (published as *T. m. mandarinus*) | 11 | 中國黑鶇 *Turdus mandarinus* t0096597 | TaiCOL matched the subspecies *T. m. mandarinus* t0028405; the species row is the safer name. |
| *Prinia crinigera striata* | 1 | 斑紋鷦鶯 *Prinia striata* t0098584 | TaiCOL matched the subspecies row t0085129; same question. |
| *Chaetura pelagica* | 9 | none | The Chimney Swift, an American bird. Almost certainly a data-entry error at TaiRON. Leave the records unnamed, and include it in the owner's message to TaiRON. |

A name the biologist confirms goes into `scripts/taxon-crosswalk.json` under its
published name, so that a re-import keeps it, with `"via": "biologist"` and the
date. The importer reads that file. `scripts/remap-gbif-taxa.ts` wrote it
once and is not run again, so a hand-added entry stays. Then a migration in the
shape of 0037 moves the records. Do not add a crosswalk entry before the owner
agrees to the loosening: the next import would apply it.
