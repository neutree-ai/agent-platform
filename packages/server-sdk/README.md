# @neutree-ai/server-sdk

For the backend of an application built on the Neutree Agent Platform. Your application keeps its own users, pages and data; the platform runs an agent workspace for each user. This SDK covers the four places the two meet:

- **`AppClient`** provisions your users on the platform and acts as them, with your application's client id and secret.
- **`createSessionRelay`** relays the [UI SDK](https://www.npmjs.com/package/@neutree-ai/ui-sdk)'s session calls from the browser to the platform, as the signed-in person.
- **`CallerVerifier`** verifies, on your application's MCP server, which user, workspace and session a call comes from.
- **`calledAgents` / `describeCall`** read an agent transcript.

No runtime dependencies: it uses `fetch` and Web Crypto (Node 20+, Bun, Deno, edge runtimes).

```sh
npm install @neutree-ai/server-sdk
```

## Register the application

An admin registers your application under **Applications** on the platform. That gives you a client id and secret. There you also declare:

- **Teams** that every user your application provisions joins.
- **MCP servers**: the origins of your own MCP servers. Agent calls to them go through the platform, which attaches a signed statement of who is calling.

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

When an agent calls an MCP server your application declared, the platform adds `X-Platform-Caller`: a five-minute ES256 JWT addressed to your application. Verify it instead of trusting any plain header, since an agent can reach your server directly and send whatever headers it likes.

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
