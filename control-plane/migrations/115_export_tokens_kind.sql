-- Distinguish file vs directory export tokens. A 'dir' token is served as a
-- zip archive by the public-exports app (dufs `?zip`); 'file' keeps the
-- existing single-file proxy behavior. DEFAULT 'file' keeps every existing
-- token valid without a backfill.
ALTER TABLE public.export_tokens
    ADD COLUMN kind text NOT NULL DEFAULT 'file';
