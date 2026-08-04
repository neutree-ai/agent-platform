// Workspace protocol endpoints (/workspace/v1/*).
//
// Calls a workspace's own workloads make back into cp: the agent server reads
// its config, credentials and skills; the memory-fuse and afs sidecars read and
// write their mounts. Auth is the workspace-token middleware, which yields a
// single workspaceId; routes carrying a workspace id in the path additionally
// apply requireWorkspaceParam so the two must agree.
//
// Plain Hono (not OpenAPIHono) — a machine protocol, not part of the
// user-facing API docs, same as /env/v1 next door. The global user-auth
// middleware skips /workspace/v1/* (see index.ts); this router's own middleware is
// what guards it.

import { Hono } from 'hono'
import type { WorkspaceAppEnv } from '../../lib/types'
import { workspaceAuth } from '../../middleware/workspace-auth'
import mcpProxy from '../mcp-proxy'
import afs from './afs'
import config from './config'
import credentials from './credentials'
import memory from './memory'
import skills from './skills'

const ws = new Hono<WorkspaceAppEnv>()

ws.use('*', workspaceAuth)

ws.route('/', afs)
ws.route('/', config)
ws.route('/', credentials)
ws.route('/', mcpProxy)
ws.route('/', memory)
ws.route('/', skills)

export default ws
