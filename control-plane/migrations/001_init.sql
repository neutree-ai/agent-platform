-- Consolidated schema baseline (control-plane).
--
-- Squashed from the historical migration chain into a single init; the schema
-- produced here is identical to running the full chain. Bootstrap rows (the
-- internal "system" user and the singleton system_settings row) are seeded by
-- scripts/seed-admin.ts, not here, so this file stays pure schema.

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: safe_jsonb(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_jsonb(t text) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  RETURN t::json::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN '[]'::jsonb;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id text NOT NULL,
    workspace_id text NOT NULL,
    session_id text,
    role text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    blocks text DEFAULT '[]'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
)
WITH (toast.autovacuum_vacuum_scale_factor='0.02', toast.autovacuum_vacuum_threshold='1000', toast.autovacuum_vacuum_cost_limit='2000');


--
-- Name: session_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_events (
    id text NOT NULL,
    message_id text NOT NULL,
    session_id text NOT NULL,
    kind text NOT NULL,
    call_id text,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    workspace_id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_active_at timestamp with time zone DEFAULT now(),
    last_turn_stats jsonb,
    chat_status text DEFAULT 'idle'::text NOT NULL,
    caller_user_id text,
    source text DEFAULT 'web'::text NOT NULL,
    pending_message jsonb,
    starred_at timestamp with time zone
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    node_port integer,
    status text DEFAULT 'running'::text,
    created_at timestamp with time zone DEFAULT now(),
    chat_status text DEFAULT 'idle'::text NOT NULL,
    chat_status_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text,
    visibility text DEFAULT 'private'::text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_workspace_slug CHECK (((slug IS NULL) OR (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::text))),
    CONSTRAINT chk_workspace_visibility CHECK ((visibility = ANY (ARRAY['private'::text, 'user'::text, 'public'::text])))
);


--
-- Name: admin_daily_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_daily_stats AS
 SELECT d.date,
    COALESCE(w.count, 0) AS new_workspaces,
    COALESCE(s.count, 0) AS new_sessions,
    COALESCE(m.interactions, 0) AS interactions,
    COALESCE(a.count, 0) AS active_workspaces
   FROM ((((generate_series((( SELECT (min(workspaces.created_at))::date AS min
           FROM public.workspaces))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d(date)
     LEFT JOIN ( SELECT (date_trunc('day'::text, workspaces.created_at))::date AS day,
            (count(*))::integer AS count
           FROM public.workspaces
          GROUP BY ((date_trunc('day'::text, workspaces.created_at))::date)) w ON ((w.day = (d.date)::date)))
     LEFT JOIN ( SELECT (date_trunc('day'::text, sessions.created_at))::date AS day,
            (count(*))::integer AS count
           FROM public.sessions
          GROUP BY ((date_trunc('day'::text, sessions.created_at))::date)) s ON ((s.day = (d.date)::date)))
     LEFT JOIN ( SELECT (date_trunc('day'::text, m_1.created_at))::date AS day,
            ((count(*) FILTER (WHERE (m_1.role = 'user'::text)) + COALESCE(sum(ec.cnt) FILTER (WHERE (m_1.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
           FROM (public.messages m_1
             LEFT JOIN ( SELECT session_events.message_id,
                    (count(*))::integer AS cnt
                   FROM public.session_events
                  GROUP BY session_events.message_id) ec ON ((ec.message_id = m_1.id)))
          GROUP BY ((date_trunc('day'::text, m_1.created_at))::date)) m ON ((m.day = (d.date)::date)))
     LEFT JOIN ( SELECT (d2.date)::date AS day,
            (count(DISTINCT s2.workspace_id))::integer AS count
           FROM (generate_series((( SELECT (min(workspaces.created_at))::date AS min
                   FROM public.workspaces))::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 day'::interval) d2(date)
             JOIN public.sessions s2 ON (((s2.last_active_at >= ((d2.date)::date - '6 days'::interval)) AND (s2.last_active_at < ((d2.date)::date + '1 day'::interval)))))
          GROUP BY d2.date) a ON ((a.day = (d.date)::date)))
  WITH NO DATA;


--
-- Name: workspace_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_usage_events (
    id bigint NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    session_id text,
    source text NOT NULL,
    model text NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cache_read_tokens bigint DEFAULT 0 NOT NULL,
    cache_creation_tokens bigint DEFAULT 0 NOT NULL,
    cache_creation_5m_tokens bigint DEFAULT 0 NOT NULL,
    cache_creation_1h_tokens bigint DEFAULT 0 NOT NULL,
    reasoning_output_tokens bigint DEFAULT 0 NOT NULL,
    web_search_requests integer DEFAULT 0 NOT NULL,
    speed text,
    fields_incomplete boolean DEFAULT false NOT NULL,
    ts timestamp with time zone,
    dedup_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_token_daily_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_token_daily_stats AS
 SELECT (date_trunc('day'::text, ts))::date AS day,
    (sum(input_tokens))::bigint AS input_tokens,
    (sum(output_tokens))::bigint AS output_tokens,
    (sum(cache_creation_tokens))::bigint AS cache_write_tokens,
    (sum(cache_read_tokens))::bigint AS cache_read_tokens
   FROM public.workspace_usage_events
  WHERE (ts IS NOT NULL)
  GROUP BY ((date_trunc('day'::text, ts))::date)
  WITH NO DATA;


--
-- Name: admin_token_user_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_token_user_stats AS
 SELECT user_id,
    (sum(input_tokens))::bigint AS input_tokens,
    (sum(output_tokens))::bigint AS output_tokens,
    (sum(cache_read_tokens))::bigint AS cache_read_tokens,
    (sum(cache_creation_tokens))::bigint AS cache_creation_tokens
   FROM public.workspace_usage_events
  GROUP BY user_id
  WITH NO DATA;


--
-- Name: admin_token_workspace_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_token_workspace_stats AS
 SELECT workspace_id,
    (sum(input_tokens))::bigint AS input_tokens,
    (sum(output_tokens))::bigint AS output_tokens,
    (sum(cache_read_tokens))::bigint AS cache_read_tokens,
    (sum(cache_creation_tokens))::bigint AS cache_creation_tokens
   FROM public.workspace_usage_events
  GROUP BY workspace_id
  WITH NO DATA;


--
-- Name: admin_workspace_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.admin_workspace_stats AS
 SELECT m.workspace_id,
    ((count(*) FILTER (WHERE (m.role = 'user'::text)) + COALESCE(sum(ec.cnt) FILTER (WHERE (m.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
   FROM (public.messages m
     LEFT JOIN ( SELECT session_events.message_id,
            (count(*))::integer AS cnt
           FROM public.session_events
          GROUP BY session_events.message_id) ec ON ((ec.message_id = m.id)))
  GROUP BY m.workspace_id
  WITH NO DATA;


--
-- Name: afs_share_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.afs_share_members (
    share_id text NOT NULL,
    workspace_id text NOT NULL,
    permission text NOT NULL,
    mounted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT afs_share_members_permission_check CHECK ((permission = ANY (ARRAY['read_only'::text, 'read_write'::text])))
);


--
-- Name: afs_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.afs_shares (
    id text NOT NULL,
    owner_workspace_id text NOT NULL,
    name text NOT NULL,
    afs_dir_id text NOT NULL,
    access_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    applied_at timestamp with time zone,
    CONSTRAINT agent_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'applied'::text])))
);


--
-- Name: batch_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_runs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    concurrency integer DEFAULT 1 NOT NULL,
    stats jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: batch_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.batch_tasks (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    batch_run_id text NOT NULL,
    workspace_id text NOT NULL,
    prompt text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    session_id text,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: export_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_tokens (
    token text NOT NULL,
    workspace_id text NOT NULL,
    path text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mcp_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_catalog (
    id text NOT NULL,
    label text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    url text NOT NULL,
    saas_url text,
    "group" text DEFAULT 'Other'::text NOT NULL,
    ui_panel text,
    required boolean DEFAULT false NOT NULL,
    params jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hooks jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: mcp_oauth_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_clients (
    server_origin text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    client_id text NOT NULL,
    client_secret text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mcp_oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_oauth_tokens (
    user_id text NOT NULL,
    server_origin text NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    token_type text DEFAULT 'Bearer'::text NOT NULL,
    scope text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memories (
    id text NOT NULL,
    store_id text NOT NULL,
    path text NOT NULL,
    content text NOT NULL,
    content_sha256 text NOT NULL,
    size_bytes integer NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    mem_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memory_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_stores (
    id text NOT NULL,
    owner_user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memory_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_versions (
    id text NOT NULL,
    store_id text NOT NULL,
    memory_id text,
    path text NOT NULL,
    operation text NOT NULL,
    content text,
    content_sha256 text,
    actor_kind text NOT NULL,
    actor_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT memory_versions_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['user'::text, 'agent'::text, 'reflect'::text, 'migrate'::text]))),
    CONSTRAINT memory_versions_operation_check CHECK ((operation = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'rename'::text, 'migrate'::text])))
);


--
-- Name: model_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_providers (
    id text NOT NULL,
    name text NOT NULL,
    provider_type text NOT NULL,
    base_url text NOT NULL,
    api_key text NOT NULL,
    user_id text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    description text DEFAULT ''::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    CONSTRAINT model_providers_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text])))
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_id uuid NOT NULL,
    user_id text NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id text NOT NULL,
    event_type text NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT true,
    scope text DEFAULT '*'::text NOT NULL
);


--
-- Name: notification_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reads (
    user_id text NOT NULL,
    notification_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now()
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    title text,
    body text NOT NULL,
    format text DEFAULT 'markdown'::text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    url text,
    attach jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    actor_id text,
    created_at timestamp with time zone DEFAULT now(),
    scope text DEFAULT '*'::text NOT NULL
);


--
-- Name: oauth_authorization_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_authorization_codes (
    code text NOT NULL,
    client_id text NOT NULL,
    user_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text,
    scope text DEFAULT 'profile'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_clients (
    id text NOT NULL,
    name text NOT NULL,
    secret_hash text,
    redirect_uris text[] NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    homepage_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oauth_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_refresh_tokens (
    token_hash text NOT NULL,
    client_id text NOT NULL,
    user_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: plugins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugins (
    id text NOT NULL,
    version text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    description text,
    bundle bytea NOT NULL,
    bundle_size integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb
);


--
-- Name: prompt_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_grants (
    prompt_id text NOT NULL,
    team_id text NOT NULL,
    permission text DEFAULT 'viewer'::text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prompt_grants_permission_check CHECK ((permission = ANY (ARRAY['viewer'::text, 'editor'::text])))
);


--
-- Name: prompt_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_versions (
    id text NOT NULL,
    prompt_id text NOT NULL,
    version integer NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompts (
    id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    visibility text DEFAULT 'private'::text NOT NULL,
    CONSTRAINT prompts_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text])))
);


--
-- Name: provider_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_grants (
    provider_id text NOT NULL,
    team_id text NOT NULL,
    permission text DEFAULT 'viewer'::text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT provider_grants_permission_check CHECK ((permission = ANY (ARRAY['viewer'::text, 'editor'::text])))
);


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    cron text,
    prompt text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    prompt_id text,
    run_at timestamp with time zone,
    completed_at timestamp with time zone,
    pgboss_job_id text,
    origin text DEFAULT 'local'::text NOT NULL,
    CONSTRAINT schedules_kind_xor CHECK (((cron IS NOT NULL) <> (run_at IS NOT NULL))),
    CONSTRAINT schedules_origin_check CHECK ((origin = ANY (ARRAY['local'::text, 'template'::text])))
);


--
-- Name: service_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_tokens (
    id text NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone,
    is_platform boolean DEFAULT false NOT NULL,
    token text
);


--
-- Name: session_export_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_export_tokens (
    token text NOT NULL,
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_tokens (
    token uuid NOT NULL,
    workspace_id text NOT NULL,
    session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shares (
    id text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    session_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: skill_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_grants (
    team_id text NOT NULL,
    permission text DEFAULT 'viewer'::text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    skill_id uuid NOT NULL,
    CONSTRAINT skill_grants_permission_check CHECK ((permission = ANY (ARRAY['viewer'::text, 'editor'::text])))
);


--
-- Name: skill_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    git_type text,
    git_url text,
    git_host text,
    git_owner text,
    git_repo text,
    git_ref text,
    credential_name text,
    last_commit_sha text,
    last_synced_at timestamp with time zone,
    draft_package bytea,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_sources_kind_check CHECK ((kind = ANY (ARRAY['git'::text, 'native'::text])))
);


--
-- Name: skill_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id uuid NOT NULL,
    source_id uuid NOT NULL,
    package bytea NOT NULL,
    content_hash text GENERATED ALWAYS AS (encode(public.digest(package, 'sha256'::text), 'hex'::text)) STORED,
    commit_sha text,
    note text,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by text NOT NULL
);


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id text NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    category text,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    subpath text DEFAULT ''::text NOT NULL,
    active_version_id uuid,
    CONSTRAINT skills_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text])))
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id smallint DEFAULT 1 NOT NULL,
    asr_active_provider text,
    asr_providers jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT system_settings_id_check CHECK ((id = 1))
);


--
-- Name: team_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_invites (
    token text NOT NULL,
    team_id text NOT NULL,
    created_by text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    team_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teamwork_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teamwork_participants (
    task_id text NOT NULL,
    workspace_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: teamwork_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teamwork_sessions (
    task_id text NOT NULL,
    session_id text NOT NULL,
    role text DEFAULT 'coordinator'::text NOT NULL,
    parent_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teamwork_sessions_role_check CHECK ((role = ANY (ARRAY['coordinator'::text, 'member'::text])))
);


--
-- Name: teamwork_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teamwork_tasks (
    id text NOT NULL,
    owner_user_id text NOT NULL,
    name text NOT NULL,
    brief text,
    coordinator_workspace_id text NOT NULL,
    afs_share_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: template_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_grants (
    template_id text NOT NULL,
    team_id text NOT NULL,
    permission text DEFAULT 'viewer'::text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT template_grants_permission_check CHECK ((permission = ANY (ARRAY['viewer'::text, 'editor'::text])))
);


--
-- Name: template_version_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_version_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_version_id text NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'plain'::text NOT NULL,
    prompt_id text,
    content text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT template_version_commands_type_check CHECK ((type = ANY (ARRAY['plain'::text, 'struct'::text])))
);


--
-- Name: template_version_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_version_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_version_id text NOT NULL,
    name text NOT NULL,
    cron text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    prompt text DEFAULT ''::text NOT NULL,
    prompt_id text,
    enabled_default boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: template_version_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_version_skills (
    template_version_id text NOT NULL,
    skill_id uuid NOT NULL
);


--
-- Name: template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_versions (
    id text NOT NULL,
    template_id text NOT NULL,
    version integer NOT NULL,
    agent_type text DEFAULT 'claude-agent-sdk'::text NOT NULL,
    system_prompt text DEFAULT ''::text NOT NULL,
    prompt_id text,
    prompt_version integer,
    mcp_config text DEFAULT '{}'::jsonb NOT NULL,
    agent_settings text DEFAULT '{}'::jsonb NOT NULL,
    compute_resources jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_id text,
    model text DEFAULT ''::text NOT NULL,
    small_model text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    layout_id text
);


--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templates (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    owner_id text NOT NULL,
    latest_version integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    visibility text DEFAULT 'private'::text NOT NULL,
    CONSTRAINT templates_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'public'::text])))
);


--
-- Name: user_credential_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credential_workspaces (
    user_id text NOT NULL,
    credential_name text NOT NULL,
    workspace_id text NOT NULL
);


--
-- Name: user_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credentials (
    user_id text NOT NULL,
    name text NOT NULL,
    inject text DEFAULT 'env'::text NOT NULL,
    path text,
    mode text,
    updated_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'active'::text NOT NULL,
    encrypted_value text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL
);


--
-- Name: user_daily_interactions; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.user_daily_interactions AS
 SELECT w.user_id,
    (date_trunc('day'::text, m.created_at))::date AS day,
    ((count(*) FILTER (WHERE (m.role = 'user'::text)) + COALESCE(sum(ec.cnt) FILTER (WHERE (m.role = 'assistant'::text)), (0)::bigint)))::integer AS interactions
   FROM (((public.messages m
     JOIN public.sessions s ON ((s.id = m.session_id)))
     JOIN public.workspaces w ON ((w.id = s.workspace_id)))
     LEFT JOIN ( SELECT session_events.message_id,
            (count(*))::integer AS cnt
           FROM public.session_events
          GROUP BY session_events.message_id) ec ON ((ec.message_id = m.id)))
  GROUP BY w.user_id, ((date_trunc('day'::text, m.created_at))::date)
  WITH NO DATA;


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    user_id text NOT NULL,
    provider text NOT NULL,
    external_id text NOT NULL,
    display_name text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profile (
    user_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    username text NOT NULL,
    display_name text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now(),
    last_login_at timestamp with time zone,
    default_prompt_id text,
    role text DEFAULT 'user'::text NOT NULL,
    password_hash text,
    auto_evolution boolean DEFAULT false NOT NULL
);


--
-- Name: workspace_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'plain'::text NOT NULL,
    prompt_id text,
    content text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origin text DEFAULT 'local'::text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    CONSTRAINT workspace_commands_origin_check CHECK ((origin = ANY (ARRAY['local'::text, 'template'::text]))),
    CONSTRAINT workspace_commands_type_check CHECK ((type = ANY (ARRAY['plain'::text, 'struct'::text])))
);


--
-- Name: workspace_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_config (
    workspace_id text NOT NULL,
    agent_type text DEFAULT 'claude-agent-sdk'::text NOT NULL,
    provider_type text DEFAULT ''::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    system_prompt text DEFAULT ''::text NOT NULL,
    mcp_config text DEFAULT '{}'::text NOT NULL,
    agent_settings text DEFAULT '{}'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    base_url text DEFAULT ''::text NOT NULL,
    api_key text DEFAULT ''::text NOT NULL,
    small_model text DEFAULT ''::text NOT NULL,
    prompt_id text,
    compute_resources jsonb DEFAULT '{}'::jsonb NOT NULL,
    template_id text,
    template_version integer,
    provider_id text,
    max_concurrency integer DEFAULT 10 NOT NULL,
    auto_start boolean DEFAULT true NOT NULL
);


--
-- Name: workspace_layout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_layout (
    id text NOT NULL,
    owner_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    skeleton jsonb NOT NULL,
    origin text DEFAULT 'local'::text NOT NULL,
    source_template_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_layout_origin_check CHECK ((origin = ANY (ARRAY['local'::text, 'template'::text])))
);


--
-- Name: workspace_memory_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_memory_attachments (
    workspace_id text NOT NULL,
    store_id text NOT NULL,
    access text DEFAULT 'read_write'::text NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_memory_attachments_access_check CHECK ((access = ANY (ARRAY['read_only'::text, 'read_write'::text])))
);


--
-- Name: workspace_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_profile (
    workspace_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_skills (
    workspace_id text NOT NULL,
    skill_id uuid NOT NULL
);


--
-- Name: workspace_tag_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_tag_assignments (
    workspace_id text NOT NULL,
    tag_id text NOT NULL
);


--
-- Name: workspace_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_tags (
    id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: workspace_usage_cursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_usage_cursor (
    workspace_id text NOT NULL,
    cursor jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_usage_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspace_usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspace_usage_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspace_usage_events_id_seq OWNED BY public.workspace_usage_events.id;


--
-- Name: ws_concurrency_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws_concurrency_slots (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    workspace_id text NOT NULL,
    job_id text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_usage_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_usage_events ALTER COLUMN id SET DEFAULT nextval('public.workspace_usage_events_id_seq'::regclass);


--
-- Name: afs_share_members afs_share_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_share_members
    ADD CONSTRAINT afs_share_members_pkey PRIMARY KEY (share_id, workspace_id);


--
-- Name: afs_shares afs_shares_owner_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_shares
    ADD CONSTRAINT afs_shares_owner_workspace_id_name_key UNIQUE (owner_workspace_id, name);


--
-- Name: afs_shares afs_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_shares
    ADD CONSTRAINT afs_shares_pkey PRIMARY KEY (id);


--
-- Name: agent_requests agent_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_requests
    ADD CONSTRAINT agent_requests_pkey PRIMARY KEY (id);


--
-- Name: batch_runs batch_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_runs
    ADD CONSTRAINT batch_runs_pkey PRIMARY KEY (id);


--
-- Name: batch_tasks batch_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_tasks
    ADD CONSTRAINT batch_tasks_pkey PRIMARY KEY (id);


--
-- Name: export_tokens export_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_tokens
    ADD CONSTRAINT export_tokens_pkey PRIMARY KEY (token);


--
-- Name: mcp_catalog mcp_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_catalog
    ADD CONSTRAINT mcp_catalog_pkey PRIMARY KEY (id);


--
-- Name: mcp_oauth_clients mcp_oauth_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_clients
    ADD CONSTRAINT mcp_oauth_clients_pkey PRIMARY KEY (server_origin);


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_pkey PRIMARY KEY (user_id, server_origin);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: memory_stores memory_stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_stores
    ADD CONSTRAINT memory_stores_pkey PRIMARY KEY (id);


--
-- Name: memory_versions memory_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_versions
    ADD CONSTRAINT memory_versions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: model_providers model_providers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_providers
    ADD CONSTRAINT model_providers_name_key UNIQUE (name);


--
-- Name: model_providers model_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_providers
    ADD CONSTRAINT model_providers_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id, event_type, channel, scope);


--
-- Name: notification_reads notification_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_pkey PRIMARY KEY (user_id, notification_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorization_codes oauth_authorization_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_authorization_codes
    ADD CONSTRAINT oauth_authorization_codes_pkey PRIMARY KEY (code);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_refresh_tokens oauth_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_tokens
    ADD CONSTRAINT oauth_refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: plugins plugins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugins
    ADD CONSTRAINT plugins_pkey PRIMARY KEY (id);


--
-- Name: prompt_grants prompt_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_grants
    ADD CONSTRAINT prompt_grants_pkey PRIMARY KEY (prompt_id, team_id);


--
-- Name: prompt_versions prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_pkey PRIMARY KEY (id);


--
-- Name: prompt_versions prompt_versions_prompt_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_prompt_id_version_key UNIQUE (prompt_id, version);


--
-- Name: prompts prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_pkey PRIMARY KEY (id);


--
-- Name: prompts prompts_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_user_id_name_key UNIQUE (user_id, name);


--
-- Name: provider_grants provider_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_grants
    ADD CONSTRAINT provider_grants_pkey PRIMARY KEY (provider_id, team_id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: service_tokens service_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_tokens
    ADD CONSTRAINT service_tokens_pkey PRIMARY KEY (id);


--
-- Name: session_events session_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_events
    ADD CONSTRAINT session_events_pkey PRIMARY KEY (id);


--
-- Name: session_export_tokens session_export_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_export_tokens
    ADD CONSTRAINT session_export_tokens_pkey PRIMARY KEY (token);


--
-- Name: session_tokens session_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_pkey PRIMARY KEY (token);


--
-- Name: session_tokens session_tokens_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_session_id_key UNIQUE (session_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: shares shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shares
    ADD CONSTRAINT shares_pkey PRIMARY KEY (id);


--
-- Name: skill_grants skill_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_grants
    ADD CONSTRAINT skill_grants_pkey PRIMARY KEY (skill_id, team_id);


--
-- Name: skill_sources skill_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_sources
    ADD CONSTRAINT skill_sources_pkey PRIMARY KEY (id);


--
-- Name: skill_versions skill_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_versions
    ADD CONSTRAINT skill_versions_pkey PRIMARY KEY (id);


--
-- Name: skill_versions skill_versions_skill_id_content_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_versions
    ADD CONSTRAINT skill_versions_skill_id_content_hash_key UNIQUE (skill_id, content_hash);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: skills skills_user_name_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_user_name_uniq UNIQUE (user_id, name);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: team_invites team_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_pkey PRIMARY KEY (token);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (team_id, user_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teamwork_participants teamwork_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_participants
    ADD CONSTRAINT teamwork_participants_pkey PRIMARY KEY (task_id, workspace_id);


--
-- Name: teamwork_sessions teamwork_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_sessions
    ADD CONSTRAINT teamwork_sessions_pkey PRIMARY KEY (task_id, session_id);


--
-- Name: teamwork_tasks teamwork_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_tasks
    ADD CONSTRAINT teamwork_tasks_pkey PRIMARY KEY (id);


--
-- Name: template_grants template_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_grants
    ADD CONSTRAINT template_grants_pkey PRIMARY KEY (template_id, team_id);


--
-- Name: template_version_commands template_version_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_commands
    ADD CONSTRAINT template_version_commands_pkey PRIMARY KEY (id);


--
-- Name: template_version_commands template_version_commands_template_version_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_commands
    ADD CONSTRAINT template_version_commands_template_version_id_name_key UNIQUE (template_version_id, name);


--
-- Name: template_version_schedules template_version_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_schedules
    ADD CONSTRAINT template_version_schedules_pkey PRIMARY KEY (id);


--
-- Name: template_version_schedules template_version_schedules_template_version_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_schedules
    ADD CONSTRAINT template_version_schedules_template_version_id_name_key UNIQUE (template_version_id, name);


--
-- Name: template_version_skills template_version_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_skills
    ADD CONSTRAINT template_version_skills_pkey PRIMARY KEY (template_version_id, skill_id);


--
-- Name: template_versions template_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_pkey PRIMARY KEY (id);


--
-- Name: template_versions template_versions_template_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_template_id_version_key UNIQUE (template_id, version);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: user_credential_workspaces user_credential_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credential_workspaces
    ADD CONSTRAINT user_credential_workspaces_pkey PRIMARY KEY (user_id, credential_name, workspace_id);


--
-- Name: user_credentials user_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id, name);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (provider, external_id);


--
-- Name: user_identities user_identities_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: user_profile user_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_pkey PRIMARY KEY (user_id);


--
-- Name: users users_ldap_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_ldap_username_key UNIQUE (username);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: workspace_commands workspace_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_commands
    ADD CONSTRAINT workspace_commands_pkey PRIMARY KEY (id);


--
-- Name: workspace_commands workspace_commands_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_commands
    ADD CONSTRAINT workspace_commands_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: workspace_config workspace_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_config
    ADD CONSTRAINT workspace_config_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_layout workspace_layout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_layout
    ADD CONSTRAINT workspace_layout_pkey PRIMARY KEY (id);


--
-- Name: workspace_memory_attachments workspace_memory_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memory_attachments
    ADD CONSTRAINT workspace_memory_attachments_pkey PRIMARY KEY (workspace_id, store_id);


--
-- Name: workspace_profile workspace_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profile
    ADD CONSTRAINT workspace_profile_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_skills workspace_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_pkey PRIMARY KEY (workspace_id, skill_id);


--
-- Name: workspace_tag_assignments workspace_tag_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tag_assignments
    ADD CONSTRAINT workspace_tag_assignments_pkey PRIMARY KEY (workspace_id, tag_id);


--
-- Name: workspace_tags workspace_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_pkey PRIMARY KEY (id);


--
-- Name: workspace_tags workspace_tags_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_user_id_name_key UNIQUE (user_id, name);


--
-- Name: workspace_usage_cursor workspace_usage_cursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_usage_cursor
    ADD CONSTRAINT workspace_usage_cursor_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_usage_events workspace_usage_events_dedup_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_usage_events
    ADD CONSTRAINT workspace_usage_events_dedup_key_key UNIQUE (dedup_key);


--
-- Name: workspace_usage_events workspace_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_usage_events
    ADD CONSTRAINT workspace_usage_events_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: ws_concurrency_slots ws_concurrency_slots_job_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_concurrency_slots
    ADD CONSTRAINT ws_concurrency_slots_job_id_key UNIQUE (job_id);


--
-- Name: ws_concurrency_slots ws_concurrency_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_concurrency_slots
    ADD CONSTRAINT ws_concurrency_slots_pkey PRIMARY KEY (id);


--
-- Name: admin_daily_stats_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_daily_stats_date ON public.admin_daily_stats USING btree (date);


--
-- Name: admin_token_daily_stats_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_token_daily_stats_day ON public.admin_token_daily_stats USING btree (day);


--
-- Name: admin_token_user_stats_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_token_user_stats_user ON public.admin_token_user_stats USING btree (user_id);


--
-- Name: admin_token_workspace_stats_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_token_workspace_stats_ws ON public.admin_token_workspace_stats USING btree (workspace_id);


--
-- Name: admin_workspace_stats_ws_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_workspace_stats_ws_id ON public.admin_workspace_stats USING btree (workspace_id);


--
-- Name: afs_share_members_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX afs_share_members_workspace ON public.afs_share_members USING btree (workspace_id);


--
-- Name: afs_shares_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX afs_shares_owner ON public.afs_shares USING btree (owner_workspace_id);


--
-- Name: agent_requests_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_requests_user_idx ON public.agent_requests USING btree (user_id, created_at DESC);


--
-- Name: agent_requests_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_requests_workspace_idx ON public.agent_requests USING btree (workspace_id, created_at DESC);


--
-- Name: export_tokens_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX export_tokens_expires_at ON public.export_tokens USING btree (expires_at);


--
-- Name: idx_batch_runs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_runs_user ON public.batch_runs USING btree (user_id);


--
-- Name: idx_batch_tasks_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_tasks_run ON public.batch_tasks USING btree (batch_run_id);


--
-- Name: idx_batch_tasks_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_tasks_workspace ON public.batch_tasks USING btree (workspace_id);


--
-- Name: idx_deliveries_notification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_notification ON public.notification_deliveries USING btree (notification_id);


--
-- Name: idx_deliveries_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_pending ON public.notification_deliveries USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_deliveries_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_user_status ON public.notification_deliveries USING btree (user_id, status);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at);


--
-- Name: idx_messages_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_session_created ON public.messages USING btree (session_id, created_at) WHERE (session_id IS NOT NULL);


--
-- Name: idx_notifications_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_type ON public.notifications USING btree (event_type, created_at);


--
-- Name: idx_service_tokens_platform_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_service_tokens_platform_user ON public.service_tokens USING btree (created_by) WHERE ((is_platform = true) AND (revoked_at IS NULL));


--
-- Name: idx_session_export_tokens_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_export_tokens_expires ON public.session_export_tokens USING btree (expires_at);


--
-- Name: idx_session_tokens_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_tokens_workspace ON public.session_tokens USING btree (workspace_id);


--
-- Name: idx_sessions_caller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_caller ON public.sessions USING btree (caller_user_id) WHERE (caller_user_id IS NOT NULL);


--
-- Name: idx_sessions_last_active_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_last_active_at ON public.sessions USING btree (last_active_at);


--
-- Name: idx_sessions_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_workspace ON public.sessions USING btree (workspace_id);


--
-- Name: idx_shares_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shares_workspace ON public.shares USING btree (workspace_id);


--
-- Name: idx_template_version_commands_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_version_commands_version ON public.template_version_commands USING btree (template_version_id);


--
-- Name: idx_template_version_schedules_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_version_schedules_version ON public.template_version_schedules USING btree (template_version_id);


--
-- Name: idx_user_identities_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_identities_user ON public.user_identities USING btree (user_id);


--
-- Name: idx_workspace_layout_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_layout_owner ON public.workspace_layout USING btree (owner_id);


--
-- Name: idx_workspace_user_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_workspace_user_slug ON public.workspaces USING btree (user_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_ws_concurrency_slots_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_concurrency_slots_workspace ON public.ws_concurrency_slots USING btree (workspace_id);


--
-- Name: idx_wta_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wta_tag_id ON public.workspace_tag_assignments USING btree (tag_id);


--
-- Name: idx_wue_user_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wue_user_ts ON public.workspace_usage_events USING btree (user_id, ts);


--
-- Name: idx_wue_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wue_workspace ON public.workspace_usage_events USING btree (workspace_id);


--
-- Name: memories_store_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX memories_store_path_idx ON public.memories USING btree (store_id, path);


--
-- Name: memory_versions_store_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_versions_store_created_idx ON public.memory_versions USING btree (store_id, created_at DESC);


--
-- Name: memory_versions_store_path_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_versions_store_path_created_idx ON public.memory_versions USING btree (store_id, path, created_at DESC);


--
-- Name: prompt_grants_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prompt_grants_team_idx ON public.prompt_grants USING btree (team_id);


--
-- Name: provider_grants_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provider_grants_team_idx ON public.provider_grants USING btree (team_id);


--
-- Name: session_events_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_events_message_id_idx ON public.session_events USING btree (message_id, id);


--
-- Name: session_events_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_events_session_id_idx ON public.session_events USING btree (session_id, id);


--
-- Name: skill_grants_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_grants_team_idx ON public.skill_grants USING btree (team_id);


--
-- Name: skill_sources_git_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX skill_sources_git_uniq ON public.skill_sources USING btree (user_id, git_url, git_ref) WHERE (kind = 'git'::text);


--
-- Name: skill_sources_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_sources_user_idx ON public.skill_sources USING btree (user_id);


--
-- Name: skill_versions_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_versions_skill_idx ON public.skill_versions USING btree (skill_id, published_at DESC);


--
-- Name: team_invites_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_invites_expires_at ON public.team_invites USING btree (expires_at);


--
-- Name: team_invites_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_invites_team ON public.team_invites USING btree (team_id);


--
-- Name: team_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_user ON public.team_members USING btree (user_id);


--
-- Name: teams_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teams_created_by ON public.teams USING btree (created_by);


--
-- Name: teamwork_participants_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teamwork_participants_workspace ON public.teamwork_participants USING btree (workspace_id);


--
-- Name: teamwork_sessions_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teamwork_sessions_parent ON public.teamwork_sessions USING btree (parent_session_id) WHERE (parent_session_id IS NOT NULL);


--
-- Name: teamwork_sessions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teamwork_sessions_session ON public.teamwork_sessions USING btree (session_id);


--
-- Name: teamwork_tasks_coordinator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teamwork_tasks_coordinator ON public.teamwork_tasks USING btree (coordinator_workspace_id);


--
-- Name: teamwork_tasks_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teamwork_tasks_owner ON public.teamwork_tasks USING btree (owner_user_id);


--
-- Name: template_grants_team_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_grants_team_idx ON public.template_grants USING btree (team_id);


--
-- Name: uq_workspace_layout_template_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_workspace_layout_template_source ON public.workspace_layout USING btree (owner_id, source_template_id) WHERE ((origin = 'template'::text) AND (source_template_id IS NOT NULL));


--
-- Name: user_daily_interactions_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_daily_interactions_day ON public.user_daily_interactions USING btree (day);


--
-- Name: user_daily_interactions_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_daily_interactions_user_day ON public.user_daily_interactions USING btree (user_id, day);


--
-- Name: workspace_memory_attachments_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workspace_memory_attachments_store_idx ON public.workspace_memory_attachments USING btree (store_id);


--
-- Name: afs_share_members afs_share_members_share_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_share_members
    ADD CONSTRAINT afs_share_members_share_id_fkey FOREIGN KEY (share_id) REFERENCES public.afs_shares(id) ON DELETE CASCADE;


--
-- Name: afs_share_members afs_share_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_share_members
    ADD CONSTRAINT afs_share_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: afs_shares afs_shares_owner_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.afs_shares
    ADD CONSTRAINT afs_shares_owner_workspace_id_fkey FOREIGN KEY (owner_workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: agent_requests agent_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_requests
    ADD CONSTRAINT agent_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: agent_requests agent_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_requests
    ADD CONSTRAINT agent_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: batch_tasks batch_tasks_batch_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_tasks
    ADD CONSTRAINT batch_tasks_batch_run_id_fkey FOREIGN KEY (batch_run_id) REFERENCES public.batch_runs(id) ON DELETE CASCADE;


--
-- Name: batch_tasks batch_tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.batch_tasks
    ADD CONSTRAINT batch_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: export_tokens export_tokens_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_tokens
    ADD CONSTRAINT export_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_server_origin_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_server_origin_fkey FOREIGN KEY (server_origin) REFERENCES public.mcp_oauth_clients(server_origin) ON DELETE CASCADE;


--
-- Name: mcp_oauth_tokens mcp_oauth_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_oauth_tokens
    ADD CONSTRAINT mcp_oauth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memories memories_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.memory_stores(id) ON DELETE CASCADE;


--
-- Name: memory_stores memory_stores_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_stores
    ADD CONSTRAINT memory_stores_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memory_versions memory_versions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_versions
    ADD CONSTRAINT memory_versions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.memory_stores(id) ON DELETE CASCADE;


--
-- Name: messages messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: model_providers model_providers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_providers
    ADD CONSTRAINT model_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: notification_deliveries notification_deliveries_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: notification_reads notification_reads_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reads
    ADD CONSTRAINT notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id);


--
-- Name: oauth_authorization_codes oauth_authorization_codes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_authorization_codes
    ADD CONSTRAINT oauth_authorization_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorization_codes oauth_authorization_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_authorization_codes
    ADD CONSTRAINT oauth_authorization_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_clients oauth_clients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: oauth_refresh_tokens oauth_refresh_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_tokens
    ADD CONSTRAINT oauth_refresh_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_refresh_tokens oauth_refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_refresh_tokens
    ADD CONSTRAINT oauth_refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: prompt_grants prompt_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_grants
    ADD CONSTRAINT prompt_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: prompt_grants prompt_grants_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_grants
    ADD CONSTRAINT prompt_grants_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;


--
-- Name: prompt_grants prompt_grants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_grants
    ADD CONSTRAINT prompt_grants_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: prompt_versions prompt_versions_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_versions
    ADD CONSTRAINT prompt_versions_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;


--
-- Name: prompts prompts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: provider_grants provider_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_grants
    ADD CONSTRAINT provider_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: provider_grants provider_grants_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_grants
    ADD CONSTRAINT provider_grants_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.model_providers(id) ON DELETE CASCADE;


--
-- Name: provider_grants provider_grants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_grants
    ADD CONSTRAINT provider_grants_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: schedules schedules_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: schedules schedules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: schedules schedules_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: service_tokens service_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_tokens
    ADD CONSTRAINT service_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: session_events session_events_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_events
    ADD CONSTRAINT session_events_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: session_export_tokens session_export_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_export_tokens
    ADD CONSTRAINT session_export_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_export_tokens session_export_tokens_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_export_tokens
    ADD CONSTRAINT session_export_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: session_tokens session_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_tokens session_tokens_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_tokens
    ADD CONSTRAINT session_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_caller_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_caller_user_id_fkey FOREIGN KEY (caller_user_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: shares shares_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shares
    ADD CONSTRAINT shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: shares shares_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shares
    ADD CONSTRAINT shares_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: skill_grants skill_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_grants
    ADD CONSTRAINT skill_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: skill_grants skill_grants_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_grants
    ADD CONSTRAINT skill_grants_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skill_grants skill_grants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_grants
    ADD CONSTRAINT skill_grants_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: skill_sources skill_sources_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_sources
    ADD CONSTRAINT skill_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: skill_versions skill_versions_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_versions
    ADD CONSTRAINT skill_versions_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: skill_versions skill_versions_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_versions
    ADD CONSTRAINT skill_versions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: skill_versions skill_versions_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_versions
    ADD CONSTRAINT skill_versions_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.skill_sources(id);


--
-- Name: skills skills_active_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_active_version_id_fkey FOREIGN KEY (active_version_id) REFERENCES public.skill_versions(id) ON DELETE SET NULL;


--
-- Name: skills skills_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.skill_sources(id) ON DELETE RESTRICT;


--
-- Name: skills skills_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: team_invites team_invites_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: team_invites team_invites_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_invites
    ADD CONSTRAINT team_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teams teams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: teamwork_participants teamwork_participants_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_participants
    ADD CONSTRAINT teamwork_participants_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.teamwork_tasks(id) ON DELETE CASCADE;


--
-- Name: teamwork_participants teamwork_participants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_participants
    ADD CONSTRAINT teamwork_participants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: teamwork_sessions teamwork_sessions_parent_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_sessions
    ADD CONSTRAINT teamwork_sessions_parent_session_id_fkey FOREIGN KEY (parent_session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: teamwork_sessions teamwork_sessions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_sessions
    ADD CONSTRAINT teamwork_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: teamwork_sessions teamwork_sessions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_sessions
    ADD CONSTRAINT teamwork_sessions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.teamwork_tasks(id) ON DELETE CASCADE;


--
-- Name: teamwork_tasks teamwork_tasks_afs_share_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_tasks
    ADD CONSTRAINT teamwork_tasks_afs_share_id_fkey FOREIGN KEY (afs_share_id) REFERENCES public.afs_shares(id) ON DELETE SET NULL;


--
-- Name: teamwork_tasks teamwork_tasks_coordinator_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_tasks
    ADD CONSTRAINT teamwork_tasks_coordinator_workspace_id_fkey FOREIGN KEY (coordinator_workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: teamwork_tasks teamwork_tasks_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teamwork_tasks
    ADD CONSTRAINT teamwork_tasks_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: template_grants template_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_grants
    ADD CONSTRAINT template_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id);


--
-- Name: template_grants template_grants_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_grants
    ADD CONSTRAINT template_grants_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: template_grants template_grants_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_grants
    ADD CONSTRAINT template_grants_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- Name: template_version_commands template_version_commands_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_commands
    ADD CONSTRAINT template_version_commands_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: template_version_commands template_version_commands_template_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_commands
    ADD CONSTRAINT template_version_commands_template_version_id_fkey FOREIGN KEY (template_version_id) REFERENCES public.template_versions(id) ON DELETE CASCADE;


--
-- Name: template_version_schedules template_version_schedules_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_schedules
    ADD CONSTRAINT template_version_schedules_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: template_version_schedules template_version_schedules_template_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_schedules
    ADD CONSTRAINT template_version_schedules_template_version_id_fkey FOREIGN KEY (template_version_id) REFERENCES public.template_versions(id) ON DELETE CASCADE;


--
-- Name: template_version_skills template_version_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_skills
    ADD CONSTRAINT template_version_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;


--
-- Name: template_version_skills template_version_skills_template_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_version_skills
    ADD CONSTRAINT template_version_skills_template_version_id_fkey FOREIGN KEY (template_version_id) REFERENCES public.template_versions(id) ON DELETE CASCADE;


--
-- Name: template_versions template_versions_layout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_layout_id_fkey FOREIGN KEY (layout_id) REFERENCES public.workspace_layout(id) ON DELETE SET NULL;


--
-- Name: template_versions template_versions_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: template_versions template_versions_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.model_providers(id);


--
-- Name: template_versions template_versions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- Name: templates templates_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: user_credential_workspaces user_credential_workspaces_user_id_credential_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credential_workspaces
    ADD CONSTRAINT user_credential_workspaces_user_id_credential_name_fkey FOREIGN KEY (user_id, credential_name) REFERENCES public.user_credentials(user_id, name) ON DELETE CASCADE;


--
-- Name: user_credential_workspaces user_credential_workspaces_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credential_workspaces
    ADD CONSTRAINT user_credential_workspaces_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_credentials user_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credentials
    ADD CONSTRAINT user_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profile user_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profile
    ADD CONSTRAINT user_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_default_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_default_prompt_id_fkey FOREIGN KEY (default_prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: workspace_commands workspace_commands_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_commands
    ADD CONSTRAINT workspace_commands_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: workspace_commands workspace_commands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_commands
    ADD CONSTRAINT workspace_commands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: workspace_commands workspace_commands_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_commands
    ADD CONSTRAINT workspace_commands_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_config workspace_config_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_config
    ADD CONSTRAINT workspace_config_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;


--
-- Name: workspace_config workspace_config_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_config
    ADD CONSTRAINT workspace_config_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.model_providers(id);


--
-- Name: workspace_config workspace_config_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_config
    ADD CONSTRAINT workspace_config_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;


--
-- Name: workspace_config workspace_config_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_config
    ADD CONSTRAINT workspace_config_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_layout workspace_layout_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_layout
    ADD CONSTRAINT workspace_layout_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: workspace_layout workspace_layout_source_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_layout
    ADD CONSTRAINT workspace_layout_source_template_id_fkey FOREIGN KEY (source_template_id) REFERENCES public.templates(id) ON DELETE SET NULL;


--
-- Name: workspace_memory_attachments workspace_memory_attachments_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memory_attachments
    ADD CONSTRAINT workspace_memory_attachments_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.memory_stores(id) ON DELETE CASCADE;


--
-- Name: workspace_memory_attachments workspace_memory_attachments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memory_attachments
    ADD CONSTRAINT workspace_memory_attachments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_profile workspace_profile_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profile
    ADD CONSTRAINT workspace_profile_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_skills workspace_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE RESTRICT;


--
-- Name: workspace_skills workspace_skills_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_skills
    ADD CONSTRAINT workspace_skills_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_tag_assignments workspace_tag_assignments_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tag_assignments
    ADD CONSTRAINT workspace_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.workspace_tags(id) ON DELETE CASCADE;


--
-- Name: workspace_tag_assignments workspace_tag_assignments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tag_assignments
    ADD CONSTRAINT workspace_tag_assignments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_tags workspace_tags_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_tags
    ADD CONSTRAINT workspace_tags_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ws_concurrency_slots ws_concurrency_slots_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws_concurrency_slots
    ADD CONSTRAINT ws_concurrency_slots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


