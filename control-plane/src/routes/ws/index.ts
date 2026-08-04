// Workspace protocol endpoints (/ws/v1/*).
//
// Calls a workspace's own workloads make back into cp: the agent server reads
// its config, credentials and skills; the memory-fuse and afs sidecars read and
// write their mounts. Auth is the workspace-token middleware, which yields a
// single workspaceId; routes carrying a workspace id in the path additionally
// apply requireWorkspaceParam so the two must agree.
//
// Plain Hono (not OpenAPIHono) — a machine protocol, not part of the
// user-facing API docs, same as /env/v1 next door. The global user-auth
// middleware skips /ws/v1/* (see index.ts); this router's own middleware is
// what guards it.
//
// This is the destination for the routes still sitting under the unauthenticated
// /_cp prefix. They move one at a time, each one arriving here already
// authenticated, and /_cp shrinks until it can be deleted outright.

import { Hono } from 'hono'
import type { WsAppEnv } from '../../lib/types'
import { wsAuth } from '../../middleware/ws-auth'
import credentials from './credentials'

const ws = new Hono<WsAppEnv>()

ws.use('*', wsAuth)

ws.route('/', credentials)

export default ws
