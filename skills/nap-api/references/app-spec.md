# App Spec — building a multi-user application on NAP

Read this when you are helping someone build an **application whose own users each get NAP agents**: a tutoring site where every student has a study agent, an ops console where every engineer has an on-call agent. The application keeps its users, pages and data; NAP runs the agents. The App Spec is the one document in which the application declares those agents.

If the task is to drive one person's own workspaces (create one, chat with it, upload files), you don't need any of this: use the `workspaces` / `chat` resources with a service token.

## The model

```
application (client id + secret, registered by an NAP admin)
├── team            what's shared with it, its users can use
├── content         prompts and skills it publishes  (/apps/v1/prompts, /apps/v1/skills)
├── spec            its agents                       (/apps/v1/spec)
│     agent  ──►  a template the application owns, one version per change
└── users           provisioned by the application  (/apps/v1/users/{external_id})
      └── one workspace per agent, created on first request, kept in line with the spec
```

- Every `/apps/v1/*` call authenticates as the application: HTTP Basic with the client id and secret (`appClientAuth`). Never send the secret to a browser.
- To act **as** one of its users (chat, read files), the application exchanges its credentials for a short-lived user token: `POST /apps/v1/users/{external_id}/token`, then `Authorization: Bearer <token>` on the regular `/api/*` routes.
- Users the application provisions cannot sign in to NAP. They see NAP only through the application.

In TypeScript, `@neutree-ai/server-sdk`'s `AppClient` wraps all of this (`publishPrompt`, `publishSkill`, `applySpec`, `ensureAgent`, `as(user)`). Prefer it over hand-written requests when the application is in TypeScript.

## Before the first apply

The spec can't grant the application anything. An NAP admin (or whoever registered the application, as admin of its team) must share with the **application's team**:

- every **provider** the spec's `model.provider` names;
- every **environment** a `runtime.environment` names (omit it to use the built-in one);
- any **skill** or **prompt** the application uses but doesn't publish itself.

An unresolved reference is a 400 listing each one ("provider deepseek is not published by or shared with the application"). That message means *ask for a share*, not *change the spec*.

## Repository layout and the deploy step

Keep the spec and its content in the application's repository and apply them on every deploy. Every step is idempotent, so the deploy can run all of them every time:

```
nap/
├── spec.yaml
├── prompts/study.md
└── skills/well-whale/SKILL.md …
```

1. **Publish content.** `PUT /apps/v1/prompts/{name}` (JSON `{ "content": "…" }`) and `PUT /apps/v1/skills/{name}` (body: a `.tar.gz` or `.zip` with `SKILL.md` at its root). Same text, same bytes → same version. Build skill archives **reproducibly** (sorted entries, fixed mtimes, no `._*` files) or every deploy creates a new skill version.
2. **Dry run.** `PUT /apps/v1/spec?dry_run=true` returns the plan without changing anything. A dry run also refuses what the real apply would refuse, so a passing dry run is a plan the apply accepts.
3. **Apply.** `PUT /apps/v1/spec` (`Content-Type: application/yaml` for YAML). `changed: false` means the spec resolved to the one in force: nothing happens.

Never pass `prune=true` from an automated deploy by default. Make it an explicit, reviewed choice (see [Removing things](#removing-things)).

## Writing the spec

```yaml
apiVersion: nap.app/v1

mcp_servers:
  whale: { url: https://whale.example.com/mcp, identify_caller: true }

agents:
  study:
    runtime:
      agent_type: claude-code
      max_concurrency: 4          # turns at once per replica
      max_steps: 200              # model round-trips per turn
      compute: { cpu_limit: "1", memory_limit: 2Gi }
    model: { provider: deepseek, name: deepseek-v4, small: deepseek-v4-flash }
    prompt: study                 # pinned to its current version at apply; or study@3
    skills: [well-whale]
    mcp: { whale: {} }
    settings: { permissions: { deny: [WebFetch] } }
    commands: { review: { content: "Review today's notes and list what to revise" } }
    schedules:
      daily: { cron: "0 9 * * *", timezone: Asia/Shanghai, prompt: "Plan today", enabled: false }
    calls: [diver]
  diver:
    runtime: { agent_type: codex }
    model: { provider: deepseek, name: deepseek-v4 }
    settings: 'model_reasoning_effort = "high"'

shared_folders:
  notes:                          # mounted at /mnt/afs/notes
    owner: study
    members: { diver: read_only }
```

Rules the server enforces, so write them right the first time:

- **Unknown fields are refused**, at every level. Don't invent fields (`roles`, `layout`, `env`, `memory`…); if something isn't in the example above, the spec can't express it yet.
- **Names** of agents, MCP servers, commands, schedules and folders: lowercase letters, digits and hyphens; folders at most 48 characters. An agent's name becomes its workspace's name and, if it is called, its slug.
- **Content is referenced by name, never inlined.** `prompt` is a prompt *name*, not prompt text. Publish the text first.

Choices that are yours to make:

- **Prompt pinning.** `prompt: study` follows the prompt at each apply: publishing new text changes nothing until the next apply, which pins the newest version. `prompt: study@3` stays on 3 until you edit the spec. Use the unpinned form when the deploy publishes and applies together; pin when the prompt is edited somewhere else and you want to adopt versions deliberately.
- **Skills are not pinned.** Workspaces load a skill's active version, so publishing a new package changes what every agent using it gets, without an apply; a running workspace picks it up the next time it loads its skills (on restart, or when a spec change reaches it). Treat a skill publish like a deploy.
- **`settings`** is passed to the agent runtime untouched: an object for JSON-configured runtimes (claude-code takes Claude Code settings: `permissions.deny`, `env`, …), a string for runtimes configured in TOML (codex) or YAML (goose). The platform doesn't validate it; test it on one workspace before relying on it.
- **`calls`** lists the agents this one hands work to. Each agent named there gets its name as slug and becomes callable by **any** of the same user's agents; the list is not an access control. Agents of different users never reach each other.
- **`mcp_servers`** are declared once and attached per agent under `mcp`. Set `identify_caller: true` only on servers the application itself runs: calls to them carry `X-Platform-Caller`, a platform-signed JWT naming the user and workspace (verify it with the SDK's `CallerVerifier`, never trust plain headers). An origin can be claimed by one application only (409 otherwise). Third-party servers (search APIs, …) leave it off.
- **Shared folders** give each user one folder, owned by the user's `owner` workspace and mounted in its `members`' workspaces. All of a folder's workspaces must be on the same environment. Use one when two agents of a user work on the same files; don't use it to pass data between users — it can't.
- **Scaling.** Without `runtime.scaling`, each workspace is one replica. With it (`min_replicas`, `max_replicas`, optional `scale_to_zero_idle_seconds`), workspaces scale between the bounds, which needs an environment with shared storage. Whether an agent scales is fixed when its workspace is created: changing it later affects new workspaces only; the bounds themselves can change.
- **`schedules`** default to `enabled: false`. Every user's workspace runs every enabled schedule, so an enabled schedule costs one turn per user per run.

## Users and their workspaces

- **Provision on sign-in.** `PUT /apps/v1/users/{external_id}` with `{ "display_name", "email" }` each time a user signs in. Use the application's own stable user id as `external_id`, never an email that can change.
- **Ensure lazily.** `PUT /apps/v1/users/{external_id}/agents/{agent}` returns the user's workspace for that agent and creates it the first time (201, then 200). Each workspace is a running container: ensure an agent when the user first needs it, not for every user at once, and not for every agent up front.
- **Then chat as the user.** Get the user's token and use `/api/workspaces/{workspace_id}/chat` (see the main skill's async chat + poll example). In the browser, relay through the application's backend (the SDK's session relay); the browser never holds a token.
- **Don't create app users' workspaces through `/api/workspaces`.** Only workspaces created by the ensure route follow the spec.
- **Deleting a user**: delete its agent workspaces first (`DELETE /apps/v1/users/{external_id}/agents/{agent}`), then the user. The platform refuses to delete a user that still owns workspaces.

## Rolling out a change

After an apply, each affected workspace moves to the new template version and the agent's new runtime **once no turn is running in it**: idle ones right away, busy ones on a sweep about every 30 seconds. A new agent type or compute shape restarts the pod; anything else reloads in place. Skills a workspace's own user added stay; only the ones the template brought are swapped.

Check progress with `GET /apps/v1/spec/status`: per agent, `workspaces`, `up_to_date` and `blocked`. For a blocked count, list the user's agents (`GET /apps/v1/users/{external_id}/agents`): each workspace has a `blocked` reason, e.g. a skill not shared with the application, or a folder member on another environment. Fix the share or the spec; the workspace catches up on the next sweep.

`GET /apps/v1/spec` returns the spec in force as applied, with each prompt locked to its version (`Accept: application/yaml` for YAML) — the record of what is running.

## Removing things

A spec that drops an agent, drops a shared folder or gives a folder another owner is refused with 409 unless applied with `prune=true`. Prune is destructive:

- a dropped agent's workspaces are deleted, for every user, with their files and sessions;
- a dropped or re-owned folder's copies are revoked, contents and all.

Before pruning, show the dry-run plan (`action: "delete"` entries, and folder entries with `changes: ["owner"]`) to the person and get an explicit yes. To retire an agent without losing users' work, keep it in the spec and stop ensuring it until its users' files are exported.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 400 `Invalid spec` | `issues` lists every problem: unknown fields, bad names, references that don't resolve, `calls`/`mcp`/folder entries naming nothing | Fix each issue. "not published by or shared with the application" → publish the content or ask for a share |
| 409 on `PUT /spec` | Drops agents or revokes folders without `prune`, or an MCP origin another application declared | Review the plan and apply with `prune` deliberately, or use another origin |
| 409 on ensure | No environment the user can use fits the agent (e.g. scaling on an environment without shared storage) | Share a suitable environment with the application's team, or change the agent's runtime |
| 409 deleting a skill | A template or workspace still uses it | Remove it from the spec and apply first |
| 404 on ensure | Unknown user (provision it first) or no such agent in the spec in force | Check the spec was applied |
