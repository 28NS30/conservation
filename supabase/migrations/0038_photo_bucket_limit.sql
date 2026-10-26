-- The photo bucket takes nothing over 3 MB.
--
-- 0004 made the bucket with a 10 MB limit per object. The report form sends a
-- photograph downscaled to 2048 px and re-encoded, a few hundred KB as WebP
-- and around a megabyte as the JPEG Safari writes instead, so 10 MB was room
-- for nothing the form makes. It was room for an address to fill the free
-- plan's 1 GB of storage with a hundred uploads that no report ever used
-- (photo-pipeline review, 26 October 2026). MAX_UPLOAD_BYTES in
-- packages/shared, which POST /api/reports checks each photo against, falls to
-- the same 3 MB in the same change.
--
-- Only ever lowers the limit: a bucket already held tighter, by hand or by a
-- later migration, is left as it is. One with no limit of its own is held to
-- Storage's global limit (50 MB unless changed), so setting 3 MB there lowers
-- it too. Nothing already stored is touched; on production on 26 October
-- 2026 the bucket held 2 objects, the largest 229,498 bytes.
--
-- Guarded like 0004's bucket: CI's PostGIS cluster has no storage schema.
-- Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets
       set file_size_limit = 3145728
     where id = 'report-photos'
       and (file_size_limit is null or file_size_limit > 3145728);
  end if;
end $$;
