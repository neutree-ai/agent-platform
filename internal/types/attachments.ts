/**
 * Input image attachment handling shared by agent implementations.
 *
 * When a user pastes an image into chat, the control-plane forwards it to the
 * agent pod as a base64 {@link ChatImageAttachment}. By default the image is
 * only available as vision content — the model can "see" it but cannot hand it
 * to a tool that needs a real file or URL (e.g. uploading to a GitLab issue via
 * an MCP tool). These helpers decode the base64 and write the bytes into the
 * agent workspace so the model can reference them as files; downstream tools can
 * then read the path directly or mint a URL via the `export_file_url` tool.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatImageAttachment } from './events.js'

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export interface WrittenAttachment {
  /** Absolute path of the written file inside the agent workspace. */
  path: string
  media_type: string
}

/**
 * Decode base64 input image attachments and write them under
 * `<workspaceDir>/.attachments/<sessionId>/img_<index>.<ext>`.
 *
 * Naming is index-based and scoped per session: a later turn's images reuse the
 * same `img_<index>` names and overwrite the previous turn's files. That is an
 * accepted trade-off — there is no cleanup, and the model receives the freshly
 * written paths within the same turn that wrote them.
 *
 * Never throws: a write failure is logged and that image is skipped, leaving the
 * existing vision-only behaviour intact.
 */
export function writeInputAttachments(
  images: ChatImageAttachment[] | undefined,
  opts: { workspaceDir: string; sessionId: string | undefined },
): WrittenAttachment[] {
  if (!images?.length) return []
  const dir = join(opts.workspaceDir, '.attachments', opts.sessionId || 'session')
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.warn(`[attachments] mkdir failed for ${dir}: ${String(err)}`)
    return []
  }
  const written: WrittenAttachment[] = []
  images.forEach((img, i) => {
    const ext = MIME_EXT[img.media_type] ?? 'bin'
    const path = join(dir, `img_${i}.${ext}`)
    try {
      writeFileSync(path, Buffer.from(img.data, 'base64'))
      written.push({ path, media_type: img.media_type })
    } catch (err) {
      console.warn(`[attachments] write failed for ${path}: ${String(err)}`)
    }
  })
  return written
}

/**
 * A text note listing the written attachment paths, to append to the user
 * prompt so the model knows the images also exist as files. Returns '' when
 * nothing was written.
 */
export function formatAttachmentNote(written: WrittenAttachment[]): string {
  if (!written.length) return ''
  const lines = written.map((w) => `- ${w.path} (${w.media_type})`)
  return `\n\n[The image(s) in this message are also saved as files in the workspace. Read these paths or pass them to tools that need a file or URL (use export_file_url to obtain a shareable URL):]\n${lines.join('\n')}`
}
