-- An application's spec (PUT /apps/v1/spec): the document that declares the
-- agents its users get.
--
-- Every apply that changes something is kept as a new version: the document as
-- written, with each prompt reference locked to its version, and the spec as
-- resolved (each reference to a provider, prompt, skill or environment turned
-- into what it named at the time). `hash` is over the resolved form, so
-- applying the same document again is a no-op until what it references
-- changes. Both are json, not jsonb, to give the document back in the order it
-- was written.
CREATE TABLE IF NOT EXISTS public.app_specs (
    client_id text NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    version integer NOT NULL,
    hash text NOT NULL,
    document json NOT NULL,
    resolved json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (client_id, version)
);

-- Each agent of the spec is a template the application's owner account owns;
-- its users' workspaces are created from it and follow its versions. `runtime`
-- holds what a template version doesn't carry: the environment, the replica
-- bounds, max_concurrency and max_steps.
CREATE TABLE IF NOT EXISTS public.app_agents (
    client_id text NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
    name text NOT NULL,
    template_id text NOT NULL UNIQUE REFERENCES public.templates(id),
    runtime jsonb NOT NULL,
    PRIMARY KEY (client_id, name)
);
