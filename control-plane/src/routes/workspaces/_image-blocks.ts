/**
 * Swap the inline base64 out of image blocks for a URL serving the same bytes.
 * Images dominate a long session's stored payload — tens of MB is routine — and
 * inlining them makes the first paint wait on every image in the transcript.
 * Behind a URL the browser fetches them lazily, in parallel, and caches them
 * across reloads. The live stream still sends `data` inline; either field alone
 * is enough to render.
 */
export function withImageUrls(workspaceId: string, messageId: string, blocks: unknown): unknown {
  if (!Array.isArray(blocks)) return blocks
  return blocks.map((block, ordinal) => {
    const b = block as { type?: unknown; data?: unknown }
    if (b?.type !== 'image' || typeof b.data !== 'string') return block
    const { data: _inline, ...rest } = b
    return {
      ...rest,
      url: `/api/workspaces/${encodeURIComponent(workspaceId)}/messages/${encodeURIComponent(messageId)}/blocks/${ordinal}/image`,
    }
  })
}
