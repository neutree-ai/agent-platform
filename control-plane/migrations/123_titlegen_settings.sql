-- System-level LLM config for automatic session-title generation.
-- Mirrors the ASR columns: an active-provider name plus a jsonb map of
-- per-provider configs keyed by provider name. Both nullable/empty by default
-- so the feature ships dormant until an admin selects an active provider.
ALTER TABLE public.system_settings
    ADD COLUMN IF NOT EXISTS titlegen_active_provider text,
    ADD COLUMN IF NOT EXISTS titlegen_providers jsonb DEFAULT '{}'::jsonb NOT NULL;
