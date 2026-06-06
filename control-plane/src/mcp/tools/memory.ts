import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { textResult } from './shared'

// Deprecated. Both tools are kept registered so agents calling the old names
// receive an actionable migration message instead of a silent tool-not-found.
// Memory is now mounted as files under /mnt/memory/<store_id>/ (see the
// platform reminder for this workspace's store paths and the `__platform__`
// skill's `reference/memory.md` for the on-disk schema). Plan to remove these
// after two release cycles.

export function registerMemoryTools(server: McpServer, _workspaceId: string) {
  server.registerTool(
    'read_memory',
    {
      title: 'Read Workspace Memory (deprecated)',
      description:
        'DEPRECATED. Memory now lives as files under /mnt/memory/<store_id>/. Use the standard read tool against those paths instead.',
      inputSchema: z.object({}),
    },
    async () => {
      return textResult(
        '[deprecated] read_memory has been removed. ' +
          'Memory is now mounted as files under /mnt/memory/<store_id>/. ' +
          "Your workspace's memory store paths are listed in the platform reminder. " +
          'Read the migrated content with the standard read tool.',
      )
    },
  )

  server.registerTool(
    'update_memory',
    {
      title: 'Update Workspace Memory (deprecated)',
      description:
        'DEPRECATED. Memory now lives as files under /mnt/memory/<store_id>/. Use the standard write/edit tools against those paths instead.',
      inputSchema: z.object({
        content: z.string().optional(),
        mode: z.enum(['append', 'overwrite']).optional(),
      }),
    },
    async () => {
      return textResult(
        '[deprecated] update_memory has been removed. ' +
          'Memory is now mounted at /mnt/memory/<store_id>/; write with the standard write/edit tools. ' +
          'Workspace store paths are listed in the platform reminder. ' +
          'Prefer multiple small files over one big blob.',
      )
    },
  )
}
