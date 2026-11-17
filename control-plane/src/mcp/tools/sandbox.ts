import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSandboxTools as registerTools } from 'neu-sandbox-mcp'
import { z } from 'zod'
import { classifyDufsPath } from '../../lib/dufs'
import { getWorkspaceAddress } from '../../lib/workspace-address'
import { createExportToken, deleteExportToken } from '../../services/db/export-tokens'
import { sandboxProviderFor, workspaceScope } from '../../services/sandbox-provider'
import { errorResult, jsonResult } from './shared'

const FILES_PUBLIC_URL = process.env.FILES_PUBLIC_URL || ''

// The upload's export token only has to outlive the moment the sandbox starts
// fetching; it is revoked as soon as the command returns.
const UPLOAD_TOKEN_TTL = 300
const UPLOAD_TIMEOUT_SECONDS = 600

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

/**
 * The command a sandbox runs to pull a workspace directory: download the
 * directory's zip from its export URL, then unpack it into `dest`. Falls back
 * across the download and unzip tools images commonly carry, and prints the
 * number of files under `dest` afterwards.
 */
export function uploadDirectoryCommand(url: string, dest: string, replace: boolean): string {
  const u = shellQuote(url)
  const d = shellQuote(dest)
  return [
    'set -e',
    'tmp=$(mktemp -d)',
    `trap 'rm -rf "$tmp"' EXIT`,
    `if command -v curl >/dev/null 2>&1; then curl -fsSL -o "$tmp/d.zip" ${u}`,
    `elif command -v wget >/dev/null 2>&1; then wget -qO "$tmp/d.zip" ${u}`,
    `else echo 'the sandbox image has neither curl nor wget' >&2; exit 127; fi`,
    ...(replace ? [`rm -rf ${d}`] : []),
    `mkdir -p ${d}`,
    `if command -v unzip >/dev/null 2>&1; then unzip -oq "$tmp/d.zip" -d ${d}`,
    `elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$tmp/d.zip" -C ${d}`,
    `elif command -v python3 >/dev/null 2>&1; then python3 -m zipfile -e "$tmp/d.zip" ${d}`,
    `else echo 'the sandbox image has none of unzip, bsdtar or python3' >&2; exit 127; fi`,
    `find ${d} -type f | wc -l`,
  ].join('\n')
}

/**
 * A directory path relative to /workspace, as dufs knows it. Accepts the
 * absolute `/workspace/...` form too, like export_file_url.
 */
async function resolveWorkspaceDir(
  workspaceId: string,
  path: string,
): Promise<{ dir: string } | { error: string }> {
  const normalized = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized) return { error: 'path is empty' }
  if (normalized.split('/').includes('..')) return { error: 'path must not contain ".."' }
  const candidates = [normalized]
  if (normalized.startsWith('workspace/')) candidates.push(normalized.slice('workspace/'.length))

  const address = getWorkspaceAddress(workspaceId)
  for (const c of candidates) {
    const encoded = c
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')
    const kind = await classifyDufsPath(`${address}/files/${encoded}`)
    if (kind === 'dir') return { dir: c }
    if (kind === 'file') return { error: `/workspace/${c} is a file, not a directory` }
  }
  return { error: `directory not found at /workspace/${normalized}` }
}

/**
 * The sandbox tools themselves live in neu-sandbox-mcp. This wires them to the
 * configured backend and confines them to the workspace: sandboxes are tagged
 * with it, and a tool only acts on a sandbox carrying the tag. The upload tool
 * stays here because it moves files out of the workspace's own file service.
 */
export function registerSandboxTools(server: McpServer, workspaceId: string) {
  const sandboxes = registerTools(server, {
    provider: sandboxProviderFor(workspaceId),
    scope: workspaceScope(workspaceId),
  })

  server.registerTool(
    'sandbox_upload_directory',
    {
      title: 'Upload Workspace Directory to Sandbox',
      description: `Copy a directory from /workspace into a sandbox in one call, binary files included. The platform moves the bytes itself, so prefer this over reading files only to pass their content to sandbox_write_files.
Files land under dest (created if missing), overwriting files of the same name. Pass replace: true to clear dest first, so files deleted in the workspace disappear from the sandbox too.
The sandbox image needs curl or wget, and unzip, bsdtar or python3; the default bookworm images have them.`,
      inputSchema: z.object({
        sandbox_id: z.string().describe('ID of the target sandbox'),
        path: z.string().describe('Directory relative to /workspace, e.g. "films/intro" or "src"'),
        dest: z
          .string()
          .regex(/^\//, 'dest must be an absolute path')
          .describe('Absolute directory inside the sandbox, e.g. "/home/user/films/intro"'),
        replace: z
          .boolean()
          .optional()
          .describe('Delete dest before unpacking, so it ends up an exact copy (default false)'),
      }),
    },
    async ({ sandbox_id, path, dest, replace }) => {
      if (!FILES_PUBLIC_URL) {
        return errorResult('Error: FILES_PUBLIC_URL env var is not set on the control plane')
      }
      let resolved: Awaited<ReturnType<typeof resolveWorkspaceDir>>
      try {
        resolved = await resolveWorkspaceDir(workspaceId, path)
      } catch (e: any) {
        return errorResult(`Error: cannot reach workspace file service (${e.message})`)
      }
      if ('error' in resolved) return errorResult(`Error: ${resolved.error}`)

      try {
        const record = await createExportToken(workspaceId, resolved.dir, UPLOAD_TOKEN_TTL, 'dir')
        try {
          const url = `${FILES_PUBLIC_URL}/${record.token}/?zip`
          const result = await sandboxes.exec(
            sandbox_id,
            uploadDirectoryCommand(url, dest, replace ?? false),
            { timeoutSeconds: UPLOAD_TIMEOUT_SECONDS },
          )
          if (result.exitCode !== 0) {
            const detail = (result.stderr || result.stdout).trim()
            return errorResult(`Error uploading directory (exit ${result.exitCode}): ${detail}`)
          }
          return jsonResult({ dest, files_in_dest: Number(result.stdout.trim()) })
        } finally {
          await deleteExportToken(workspaceId, record.token).catch(() => {})
        }
      } catch (e: any) {
        return errorResult(`Error uploading directory: ${e.message}`)
      }
    },
  )
}
