-- skills-content-service streams package downloads as substring() slices
-- (see scs src/package-stream.ts). A sliced TOAST fetch is O(slice) only
-- when the stored value is uncompressed; otherwise every slice decompresses
-- the whole datum. Tarballs are gzip data that pglz can't shrink, so in
-- practice they're stored uncompressed already — EXTERNAL makes that a
-- guarantee instead of a heuristic, and skips the futile compression
-- attempt on publish.
--
-- Applies to newly written rows; existing rows keep their storage until
-- rewritten, which is fine — they're gzip and thus uncompressed anyway.
ALTER TABLE public.skill_versions ALTER COLUMN package SET STORAGE EXTERNAL;
ALTER TABLE public.skill_sources ALTER COLUMN draft_package SET STORAGE EXTERNAL;
