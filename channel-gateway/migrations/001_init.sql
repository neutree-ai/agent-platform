-- Consolidated schema baseline (channel-gateway).
-- Squashed from the historical migration chain; identical to running the full chain.

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
-- Name: channel; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA channel;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: connectors; Type: TABLE; Schema: channel; Owner: -
--

CREATE TABLE channel.connectors (
    id text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    credentials jsonb DEFAULT '{}'::jsonb,
    service_token text,
    config jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_public boolean DEFAULT false NOT NULL
);


--
-- Name: event_log; Type: TABLE; Schema: channel; Owner: -
--

CREATE TABLE channel.event_log (
    id text NOT NULL,
    route_id text,
    event_type text NOT NULL,
    payload jsonb,
    job_id text,
    status text DEFAULT 'success'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now(),
    connector_id text,
    dedup_key text
);


--
-- Name: routes; Type: TABLE; Schema: channel; Owner: -
--

CREATE TABLE channel.routes (
    id text NOT NULL,
    external_id text NOT NULL,
    workspace_id text NOT NULL,
    name text,
    config jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    connector_id text,
    user_id text DEFAULT ''::text NOT NULL
);


--
-- Name: thread_sessions; Type: TABLE; Schema: channel; Owner: -
--

CREATE TABLE channel.thread_sessions (
    id text NOT NULL,
    route_id text NOT NULL,
    external_thread_id text NOT NULL,
    session_id text NOT NULL,
    workspace_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_active_at timestamp with time zone DEFAULT now(),
    external_channel_id text
);


--
-- Name: connectors connectors_pkey; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.connectors
    ADD CONSTRAINT connectors_pkey PRIMARY KEY (id);


--
-- Name: event_log event_log_pkey; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.event_log
    ADD CONSTRAINT event_log_pkey PRIMARY KEY (id);


--
-- Name: routes routes_connector_external_id_key; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.routes
    ADD CONSTRAINT routes_connector_external_id_key UNIQUE (connector_id, external_id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: thread_sessions thread_sessions_pkey; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.thread_sessions
    ADD CONSTRAINT thread_sessions_pkey PRIMARY KEY (id);


--
-- Name: thread_sessions thread_sessions_route_id_external_thread_id_key; Type: CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.thread_sessions
    ADD CONSTRAINT thread_sessions_route_id_external_thread_id_key UNIQUE (route_id, external_thread_id);


--
-- Name: idx_connectors_user; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_connectors_user ON channel.connectors USING btree (user_id);


--
-- Name: idx_event_log_created; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_event_log_created ON channel.event_log USING btree (created_at DESC);


--
-- Name: idx_event_log_dedup_key; Type: INDEX; Schema: channel; Owner: -
--

CREATE UNIQUE INDEX idx_event_log_dedup_key ON channel.event_log USING btree (dedup_key) WHERE (dedup_key IS NOT NULL);


--
-- Name: idx_event_log_route; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_event_log_route ON channel.event_log USING btree (route_id);


--
-- Name: idx_routes_user; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_routes_user ON channel.routes USING btree (user_id);


--
-- Name: idx_thread_sessions_active; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_thread_sessions_active ON channel.thread_sessions USING btree (last_active_at);


--
-- Name: idx_thread_sessions_lookup; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_thread_sessions_lookup ON channel.thread_sessions USING btree (route_id, external_thread_id);


--
-- Name: idx_thread_sessions_session; Type: INDEX; Schema: channel; Owner: -
--

CREATE INDEX idx_thread_sessions_session ON channel.thread_sessions USING btree (session_id);


--
-- Name: event_log event_log_connector_id_fkey; Type: FK CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.event_log
    ADD CONSTRAINT event_log_connector_id_fkey FOREIGN KEY (connector_id) REFERENCES channel.connectors(id) ON DELETE SET NULL;


--
-- Name: event_log event_log_route_id_fkey; Type: FK CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.event_log
    ADD CONSTRAINT event_log_route_id_fkey FOREIGN KEY (route_id) REFERENCES channel.routes(id) ON DELETE SET NULL;


--
-- Name: routes routes_connector_id_fk; Type: FK CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.routes
    ADD CONSTRAINT routes_connector_id_fk FOREIGN KEY (connector_id) REFERENCES channel.connectors(id) ON DELETE CASCADE;


--
-- Name: thread_sessions thread_sessions_route_id_fkey; Type: FK CONSTRAINT; Schema: channel; Owner: -
--

ALTER TABLE ONLY channel.thread_sessions
    ADD CONSTRAINT thread_sessions_route_id_fkey FOREIGN KEY (route_id) REFERENCES channel.routes(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


