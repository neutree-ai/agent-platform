# @neutree-ai/server-sdk

For the backend of an application built on the Neutree Agent Platform. Your application keeps its own users, pages and data; the platform runs an agent workspace for each user. This SDK covers the four places the two meet:

- **`AppClient`** provisions your users on the platform and acts as them, with your application's client id and secret. It also publishes your prompts and skills and applies your spec: the agents each user gets.
- **`createSessionRelay`** relays the [UI SDK](https://www.npmjs.com/package/@neutree-ai/ui-sdk)'s session calls from the browser to the platform, as the signed-in person.
- **`CallerVerifier`** verifies, on your application's MCP server, which user, workspace and session a call comes from.
- **`calledAgents` / `describeCall`** read an agent transcript.

No runtime dependencies: it uses `fetch` and Web Crypto (Node 20+, Bun, Deno, edge runtimes).

```sh
npm install @neutree-ai/server-sdk
```

## Register the application

An admin registers your application under **Applications** on the platform. That gives you a client id and secret, and a team of the application's own: every user your application provisions joins it, and providers, skills, prompts and environments shared with it are available to them.

## Users

```ts
import { AppClient } from '@neutree-ai/server-sdk'

const platform = new AppClient({
  baseUrl: process.env.NAP_URL!,
  clientId: process.env.NAP_CLIENT_ID!,
  clientSecret: process.env.NAP_CLIENT_SECRET!,
})

// On every sign-in: create the user, or update its name and email.
await platform.upsertUser(user.id, { displayName: user.name, email: user.email })

// Act as the user. Its short-lived token is obtained and renewed for you.
const nap = platform.as(user.id)
const workspaces = await nap.listWorkspaces()
await nap.request('POST', '/api/workspaces', { name: 'Main' })
```

Each user belongs to your application alone: it has no password and can't sign in to the platform itself. `platform.deleteUser(id)` removes one once it owns no workspaces.

## Agents

Declare the agents each user gets in a spec, and apply it from your deploy step. Prompts and skills the spec names are ones you publish, or ones shared with your application's team.

```ts
await platform.publishPrompt('study', await readFile('prompts/study.md', 'utf8'))
await platform.publishSkill('well-whale', await readFile('skills/well-whale.tar.gz'))

const result = await platform.applySpec(await readFile('nap.yaml', 'utf8'))
console.log(result.plan) // [{ agent: 'study', action: 'update', changes: ['prompt_version'] }]
```

```yaml
# nap.yaml
apiVersion: nap.app/v1
mcp_servers:
  whale: { url: https://whale.example.com/mcp, identify_caller: true }
agents:
  study:
    runtime: { agent_type: claude-code, max_concurrency: 4 }
    model: { provider: deepseek, name: deepseek-v4 }
    prompt: study          # pinned to its current version when applied; or study@3
    skills: [well-whale]
    mcp: { whale: {} }
    calls: [diver]         # calls the user's diver agent
  diver:
    runtime: { agent_type: codex }
    model: { provider: deepseek, name: deepseek-v4 }
shared_folders:
  notes:                   # mounted at /mnt/afs/notes
    owner: study           # the user's study workspace owns it
    members:
      diver: read_write    # or read_only
```

An agent named in some agent's `calls` is reachable by its name from any of the same user's workspaces; `calls` doesn't restrict who calls it.

Each user gets one copy of each shared folder, owned by the user's workspace for `owner` and mounted in the user's workspaces for the `members`. It is made once the owner's workspace exists, and each member is added once its workspace does, whichever you ensure first. Members the spec stops listing lose the folder, and so does any workspace it was granted to some other way. A folder that can't be set up shows in the `blocked` reason of the workspace it is about.

Publishing the same prompt text or skill package again keeps its version, and applying a spec that resolves to the one in force changes nothing, so the deploy step can run them all every time. `applySpec(spec, { dryRun: true })` returns the plan alone; a spec that drops an agent needs `{ prune: true }`, which deletes it with its users' workspaces. So does a spec that drops a shared folder or gives it another owner: `prune` revokes each user's copy, contents and all.

Each user gets a workspace per agent the first time you ask for it:

```ts
const { workspace_id } = await platform.ensureAgent(user.id, 'study')
const nap = platform.as(user.id) // chat with it as the user
```

When the spec changes an agent, its workspaces follow: each moves to the new version once no turn is running in it. `platform.specStatus()` shows how many are up to date.

## Session relay

The browser never holds a platform token. Mount the relay on your backend and point the UI SDK at it:

```ts
// Browser
configureSessionEndpoints({ apiUrl: '/api/nap', proxyUrl: '/api/nap/_proxy' })
```

```ts
// Backend (Hono shown; any framework with Request/Response works)
import { createSessionRelay } from '@neutree-ai/server-sdk'

const relay = createSessionRelay<Context>({
  basePath: '/api/nap',
  // The page names a workspace key; map it to one of the person's own workspaces.
  resolve: async (c, key) => {
    const workspaceId = await workspaceOf(c.var.user, key)
    if (!workspaceId) return new Response('{"error":"not found"}', { status: 404 })
    return { client: platform.as(c.var.user.id), workspaceId }
  },
  // Optional: refuse a message before it is sent, keep a conversation list.
  checkMessage: (body) => (tooManyImages(body) ? 'Too many images' : undefined),
  onTurn: (c, { sessionId, message, isNew }) => conversations.record(c.var.user, sessionId, message, isNew),
})

app.all('/api/nap/*', (c) => relay.handle(c.req.raw, c))
```

The relay covers the session, its messages and stored images, queued follow-ups, interrupting, sending and reconnecting to a turn, and answering an agent's question.

## Caller statement

When an agent calls an MCP server your spec declares with `identify_caller`, the platform adds `X-Platform-Caller`: a five-minute ES256 JWT addressed to your application. Verify it instead of trusting any plain header, since an agent can reach your server directly and send whatever headers it likes.

```ts
import { CallerVerifier } from '@neutree-ai/server-sdk'

const callers = new CallerVerifier({ baseUrl: process.env.NAP_URL!, clientId: process.env.NAP_CLIENT_ID! })

const caller = await callers.verify(request)
if (!caller) return new Response('Unauthorized', { status: 401 })
// caller.externalId is your own id for the user, when your application provisioned it.
// caller.workspaceId and caller.sessionId say where the call comes from.
```

The platform's public keys are read from `/.well-known/jwks.json` and cached. An unknown key id refetches them, at most once a minute.

## Transcripts

```ts
import { calledAgents, describeCall } from '@neutree-ai/server-sdk'

const messages = await nap.listMessages(workspaceId, sessionId)
calledAgents(messages) // [{ agent: 'researcher', sessionId: '…' }], the agents still to report back
describeCall(block) // 'Read …/src/app.ts'
```
