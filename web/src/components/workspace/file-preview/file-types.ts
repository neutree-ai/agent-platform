const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext ? IMAGE_EXTS.has(ext) : false
}

// Containers/codecs a browser `<video>` element can generally play inline.
// Kept in sync with the binary-fetch gate in `@/lib/api/agent-files` so these
// files are streamed by URL, not fetched as text.
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'ogv', 'm4v', 'mov'])

export function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext ? VIDEO_EXTS.has(ext) : false
}
