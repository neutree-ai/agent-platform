/**
 * Prefixes a site-absolute path with the build's base path.
 *
 * Content links go through the rehypeBaseLinks plugin; components render their
 * own markup, so they call this instead.
 */
export function withBase(path: string): string {
  const prefix = import.meta.env.BASE_URL.replace(/\/+$/, '')
  return prefix + path
}
