-- Skill exports: capability URLs that expose a single skill to local agents
-- through the Agent Skills `.well-known` discovery protocol.
--
-- Scope is deliberately per-skill (not per-user): a leaked token exposes
-- exactly one skill, and the grant is legible in the UI as "this skill is
-- exported" rather than "this person's library is shared".
--
-- Mirrors export_tokens: opaque 128-bit token as the PK, scope looked up
-- from the row (never embedded in the token), NULL expires_at = permanent,
-- revocation is a hard DELETE.
CREATE TABLE public.skill_export_tokens (
    token text NOT NULL,
    skill_id uuid NOT NULL,
    -- The name the skill is published under, and the directory name the
    -- client creates on disk. Derived from the skill name when that yields a
    -- protocol-valid slug, supplied by the user otherwise (e.g. CJK names).
    -- Frozen at mint time: deriving it per request would silently retarget an
    -- existing install if the skill were later renamed.
    slug text NOT NULL,
    -- Who minted it. Kept for listing/audit; the grant itself rides on
    -- skill_id, so this does not widen or narrow what the token can reach.
    user_id text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    -- NULL = permanent. Default TTL is applied by the service, not here.
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.skill_export_tokens
    ADD CONSTRAINT skill_export_tokens_pkey PRIMARY KEY (token);

ALTER TABLE ONLY public.skill_export_tokens
    ADD CONSTRAINT skill_export_tokens_skill_id_fkey FOREIGN KEY (skill_id)
    REFERENCES public.skills(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.skill_export_tokens
    ADD CONSTRAINT skill_export_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES public.users(id) ON DELETE CASCADE;

-- List every export for a skill (management UI).
CREATE INDEX skill_export_tokens_skill_id_idx ON public.skill_export_tokens USING btree (skill_id);

-- Expiry sweep. Unlike export_tokens (which has no sweep and grows
-- unbounded), these are long-lived and user-managed, so dead rows would
-- otherwise linger for months.
CREATE INDEX skill_export_tokens_expires_at_idx ON public.skill_export_tokens USING btree (expires_at);
