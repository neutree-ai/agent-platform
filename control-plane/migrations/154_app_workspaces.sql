-- The workspace each user of an application has for each agent of its spec
-- (PUT /apps/v1/users/{external_id}/agents/{agent}).
--
-- The workspace is created from the agent's template and follows it: when the
-- spec changes the agent, the workspace moves to the new template version and
-- takes the agent's new runtime once no turn is running in it. `runtime` is
-- the agent runtime the workspace last took.
CREATE TABLE IF NOT EXISTS public.app_workspaces (
    client_id text NOT NULL,
    agent text NOT NULL,
    user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    workspace_id text NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
    runtime jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (client_id, agent, user_id),
    FOREIGN KEY (client_id, agent) REFERENCES public.app_agents(client_id, name) ON DELETE CASCADE
);
