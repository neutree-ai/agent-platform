import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import { createExportToken } from '../../services/db/export-tokens'
import { textResult } from './shared'

const FILES_PUBLIC_URL = process.env.FILES_PUBLIC_URL || ''

const DEFAULT_TTL = 60
const MAX_TTL = 3600

export function registerExportFileUrlTool(server: McpServer, workspaceId: string) {
  server.registerTool(
    'export_file_url',
    {
      title: 'Create a public URL for a workspace file',
      description: `Mint a public HTTPS URL for a file in /workspace. The URL is reachable from outside the cluster and is intended for upstream MCPs / external services that need to fetch a local file by URL (e.g. SSRF-protected services that reject cluster-internal addresses).

**Security model**: the URL itself is the bearer token. Anyone who sees the URL can GET the file until it expires (or forever, if \`permanent: true\`). Keep TTL as short as plausibly covers the use case.

**ttl_seconds** — how long the URL stays valid (default ${DEFAULT_TTL}s, max ${MAX_TTL}s). Ignored when \`permanent: true\`:
- Consumer fetches once and fast (e.g. docx → Google Doc upload): ${DEFAULT_TTL}s
- Consumer may retry a few times or process slowly: 300s
- Long pipeline / unclear timing: up to ${MAX_TTL}s
Prefer the shortest TTL that works. Re-issuing a new URL is cheap.

**permanent** — opt into a never-expiring URL. Only use this when the user has *explicitly* asked for a shareable link they can hand out indefinitely (e.g. "give me a permanent link to this report"). Permanent links carry real risk:
- The URL is a bearer token forever — any leak (logs, screenshots, chat history, link previews) becomes a permanent backdoor.
- The link points to the *live* file path; if the file is later overwritten, readers see the new content.
- The link breaks if the file is deleted or the workspace is removed.
Default to short TTL unless the user opts in.

Returns { url, expires_at }. \`expires_at\` is \`null\` for permanent URLs. The URL ends with the original filename so clients that infer filename from the URL tail (curl -O, Google Drive) get the right name.`,
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Path to a file **relative to /workspace**, e.g. "report.docx" or "out/2026-04/summary.pdf". Do NOT include the "/workspace" prefix — pass "exports/foo.md", not "/workspace/exports/foo.md".',
          ),
        ttl_seconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_TTL)
          .default(DEFAULT_TTL)
          .describe(`URL lifetime in seconds. Default ${DEFAULT_TTL}, max ${MAX_TTL}. Ignored when permanent is true.`),
        permanent: z
          .boolean()
          .default(false)
          .describe(
            'Mint a never-expiring URL. Only when the user explicitly asks for a permanent / shareable link.',
          ),
      }),
    },
    async ({ path, ttl_seconds, permanent }) => {
      if (!FILES_PUBLIC_URL) {
        return textResult('Error: FILES_PUBLIC_URL env var is not set on the control plane')
      }
      try {
        const normalized = path.replace(/^\/+/, '')
        if (!normalized) return textResult('Error: path is empty')
        if (normalized.includes('..')) return textResult('Error: path must not contain ".."')

        // The contract is "relative to /workspace", but agents occasionally
        // pass the absolute `/workspace/foo.md` form. Probe dufs for both
        // candidates and use whichever exists — this also leaves a real
        // `workspace/` subdir under /workspace addressable without ambiguity.
        const candidates = [normalized]
        if (normalized.startsWith('workspace/')) {
          const stripped = normalized.slice('workspace/'.length)
          if (stripped) candidates.push(stripped)
        }
        const address = getWorkspaceAddress(workspaceId)
        let resolved: string | null = null
        let lastStatus = 0
        for (const c of candidates) {
          const encoded = c
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')
          let head: Response
          try {
            head = await fetch(`${address}/files/${encoded}`, { method: 'HEAD' })
          } catch (e) {
            return textResult(
              `Error: cannot reach workspace file service (${(e as Error).message})`,
            )
          }
          if (head.ok) {
            resolved = c
            break
          }
          lastStatus = head.status
        }
        if (!resolved) {
          if (lastStatus === 404) {
            const tried = candidates.map((c) => `/workspace/${c}`).join(' or ')
            return textResult(`Error: file not found at ${tried}`)
          }
          return textResult(`Error: workspace file service returned ${lastStatus}`)
        }

        const record = await createExportToken(
          workspaceId,
          resolved,
          permanent ? null : ttl_seconds,
        )
        const basename = resolved.split('/').pop() || 'file'
        const url = `${FILES_PUBLIC_URL}/${record.token}/${encodeURIComponent(basename)}`
        return textResult(
          JSON.stringify({
            url,
            expires_at: record.expires_at ? record.expires_at.toISOString() : null,
          }),
        )
      } catch (e) {
        return textResult(`Error: ${(e as Error).message}`)
      }
    },
  )
}
