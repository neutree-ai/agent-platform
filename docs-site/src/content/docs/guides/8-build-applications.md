---
title: 8. Building Applications on NAP
description: The App Spec — give every user of your own product a set of agents, declared once and kept in step by NAP
---

Chapters 1–7 were about agents people use inside NAP. This one is about agents that live inside **your** product, where each of its users has agents of their own: one assistant per customer of a service, a research agent and a writing agent per member of a team, an agent per user that works only on that user's files.

Your application keeps what it already has: its sign-in, pages, data and business rules. NAP runs the agents. The two meet in one document, the **App Spec**: what agents each user gets, with which model, prompt, skills and tools. You apply it from your deploy step, and NAP creates every user's workspaces from it and keeps them in step when it changes.

## How the pieces fit

<pre class="mermaid">
flowchart LR
  subgraph APP["Your application"]
    DEPLOY["Deploy step"]
    BACKEND["Backend<br/>sign-in, chat relay"]
  end

  subgraph NAP["NAP"]
    ACCESS["Application and its team<br/>client id + secret,<br/>resources an admin shares"]
    CONTENT["Prompts and skills<br/>the application publishes"]
    SPEC["App Spec<br/>each agent → a template"]
    USERS["Users<br/>the application provisions"]
    WS["Workspaces<br/>one per user and agent"]
  end

  DEPLOY -- "publish" --> CONTENT
  DEPLOY -- "apply" --> SPEC
  ACCESS -. "references resolve here" .-> SPEC
  CONTENT -. "referenced by name" .-> SPEC
  SPEC -- "creates and updates" --> WS
  BACKEND -- "provision on sign-in" --> USERS
  USERS -- "own" --> WS
  BACKEND -- "ensure agent,<br/>chat as the user" --> WS

  classDef app fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  classDef access fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95
  classDef declared fill:#fef3c7,stroke:#f59e0b,color:#78350f
  classDef running fill:#dcfce7,stroke:#22c55e,color:#14532d
  class DEPLOY,BACKEND app
  class ACCESS access
  class CONTENT,SPEC declared
  class USERS,WS running
</pre>

Blue is your application. In NAP, purple is access (who the application is and what it may use), amber is what the application declares, green is what runs for its users.

A few properties worth knowing before you start:

- **Your users are yours.** The application provisions them by its own user ids. They can't sign in to NAP; they reach their agents only through your application.
- **Isolation is NAP's job.** Each user's workspaces belong to that user. However the application routes requests, one user's agents never see another user's files or sessions.
- **The application acts with its credentials alone.** It never holds users' passwords; it exchanges its client id and secret for a short-lived token whenever it needs to act as a user.

## Register the application

An admin registers it in the **OAuth Apps** app (`⌘K` → **OAuth Apps**). That gives you a client id and secret — keep the secret on your backend — and creates a **team named after the application**. Every user the application provisions joins that team.

The spec can only use what is shared with that team. Before the first apply, have the admin (who registered the application and is the team's admin) share with it:

- the **model providers** the agents use (**Model Providers** app);
- any **environment** other than the built-in one (**Environments** app);
- any **skill** or **prompt** from the Library the application uses but doesn't publish itself.

The spec can't grant itself anything: what an application's users can use is decided by people, in the UI.

## Write the spec

Keep it in the application's repository, next to the prompts and skills it publishes:

```yaml
apiVersion: nap.app/v1

mcp_servers:
  app-api: { url: https://api.example.com/mcp, identify_caller: true }

agents:
  assistant:
    runtime:
      agent_type: claude-code
      max_concurrency: 4
      compute: { cpu_limit: "1", memory_limit: 2Gi }
    model: { provider: main-provider, name: large-model, small: small-model }
    prompt: assistant            # the current version when applied; or assistant@3
    skills: [report-writer]
    mcp: { app-api: {} }
    commands:
      summary: { content: "Summarize what we worked on today" }
    schedules:
      weekly-digest: { cron: "0 9 * * 1", timezone: UTC, prompt: "Write this week's digest" }
    calls: [researcher]
  researcher:
    runtime: { agent_type: codex }
    model: { provider: main-provider, name: large-model }

shared_folders:
  notes:                         # /mnt/afs/notes in both workspaces
    owner: assistant
    members: { researcher: read_only }
```

| Field | What it declares |
|---|---|
| `agents.<name>.runtime` | Agent core, environment, compute, replica bounds (`scaling`), turns per replica (`max_concurrency`), model round-trips per turn (`max_steps`) |
| `model` | A provider shared with the application, by name, and the model to use |
| `prompt` | A prompt by name. Without a version it is pinned to the current one at each apply |
| `skills` | Skills by name |
| `mcp` | Which of the spec's `mcp_servers` this agent gets |
| `settings` | The agent core's own settings, passed through as they are |
| `commands`, `schedules` | Slash commands and recurring prompts. Schedules are off unless `enabled: true` |
| `calls` | Other agents of the spec this one hands work to, as the same user |
| `mcp_servers` | MCP servers, once for all agents. `identify_caller: true` marks one the application runs itself: calls to it carry a platform-signed statement of which user and workspace made them |
| `shared_folders` | A folder each user gets, owned by one of the user's agents and mounted in others |

Three rules shape the document:

- **Unknown fields are refused.** A typo fails loudly instead of being silently ignored, and a field added in a later version can't collide with something you wrote today.
- **Content is referenced by name.** The spec says `prompt: assistant`, never the prompt's text. The text lives in the Library, versioned.
- **Collections are keyed by name.** Agents, servers, commands, schedules and folders are maps, so a change to one entry is a change to one key.

## Apply it on every deploy

The deploy step publishes the content, then applies the spec. All of it is idempotent: publishing the same prompt text or the same skill package keeps its version, and a spec that resolves to the one in force changes nothing. So the step can simply run every time.

With the [server SDK](https://www.npmjs.com/package/@neutree-ai/server-sdk):

```ts
import { AppClient } from '@neutree-ai/server-sdk'

const platform = new AppClient({ baseUrl, clientId, clientSecret })

await platform.publishPrompt('assistant', await readFile('nap/prompts/assistant.md', 'utf8'))
await platform.publishSkill('report-writer', await readFile('nap/skills/report-writer.tar.gz'))

const spec = await readFile('nap/spec.yaml', 'utf8')
const plan = await platform.applySpec(spec, { dryRun: true })
console.log(plan.plan, plan.shared_folders)
await platform.applySpec(spec)
```

Or over HTTP, with the client id and secret as Basic auth:

```bash
curl -u "$CLIENT_ID:$CLIENT_SECRET" -X PUT "$NAP_URL/apps/v1/spec?dry_run=true" \
  -H 'Content-Type: application/yaml' --data-binary @nap/spec.yaml
```

The plan lists each agent as `create`, `update` (with the fields that change), `delete` or `unchanged`, and each shared folder the same way. A reference that doesn't resolve fails the whole apply with every problem listed, typically "provider main-provider is not published by or shared with the application" — which means asking for a share, not editing the spec.

Build skill archives reproducibly (sorted entries, fixed timestamps). The bytes decide whether a package is new, so an archive rebuilt with fresh timestamps is a new version on every deploy.

## Users and their agents

On each sign-in, the application provisions the user, by its own stable user id:

```ts
await platform.upsertUser(user.id, { displayName: user.name, email: user.email })
```

The first time the user needs an agent, the application asks for its workspace. It is created then, from the agent's template, and returned as it is on later calls:

```ts
const { workspace_id } = await platform.ensureAgent(user.id, 'assistant')
const nap = platform.as(user.id)   // chat, files, sessions — as this user
```

Each workspace is a running container, so ask for an agent when the user first needs it rather than for every user up front.

In the browser, chat goes through your backend: the server SDK's session relay forwards the UI SDK's calls as the signed-in user, and the browser never holds a token. On an MCP server the application runs, verify the caller statement with the SDK's `CallerVerifier` to know which user's agent is calling.

To remove a user, delete its agent workspaces first, then the user.

## Teams of users

Users of the application who work together, such as the members of one organization in your product, can share folders with each other. Group them into a team of the application, named by your own id for it:

```ts
const team = await platform.upsertTeam(org.id, { name: org.name })
await platform.addTeamMember(org.id, user.id)
```

Only the application's own users can be in these teams, and only the application changes them; they aren't the application's team that an admin shares resources with. A member shares a folder of theirs with the team, and another member mounts it in one of their workspaces, through the folder sharing API as themselves (`platform.as(user.id)`), naming the team by `team.id`. Removing a member, or deleting the team, unmounts what the team gave them.

## Changing the spec

Edit the spec, deploy, read the plan. After an apply, every affected workspace takes the change **once no turn is running in it**: idle ones right away, busy ones within about half a minute of going idle. A new agent core or compute shape restarts the workspace; everything else reloads in place, keeping files and sessions.

`GET /apps/v1/spec/status` (`platform.specStatus()`) shows, per agent, how many workspaces are up to date and how many are blocked. A blocked workspace says why in its `blocked` reason — usually a skill or environment not shared with the application's team, or a shared folder whose workspaces are on different environments. Fix the cause and it catches up by itself.

`GET /apps/v1/spec` returns the spec in force, with each prompt pinned to the version it resolved to: the record of what every user is running.

Some changes behave differently:

- **Prompts** move only on apply. Pin `assistant@3` to adopt new versions deliberately.
- **Skills** aren't pinned. A newly published package becomes the version every agent using the skill loads, without an apply — treat publishing a skill like a deploy.
- **Single replica vs. scaling** is fixed when a workspace is created. A change applies to new workspaces; the replica bounds themselves can change.

## Removing an agent or a folder

A spec that drops an agent, drops a shared folder or gives a folder another owner is refused unless applied with `prune`. Pruning deletes the dropped agent's workspaces for every user, with their files and sessions, and revokes each user's copy of the folder with its contents. Read the dry-run plan before pruning, and keep `prune` out of the automated deploy.

## What the spec doesn't cover yet

Each user has one workspace per agent. The spec doesn't yet declare memory stores, per-user credentials or plugins, and skills can't be pinned to a version. Because unknown fields are refused, none of these can be written by mistake today, and adding them later won't change the meaning of a spec you write now.
