// Minimal ambient types for `multiplex` (no @types published). We use only
// createStream + the onStream callback; both yield Node Duplex substreams.
declare module 'multiplex' {
  import type { Duplex } from 'node:stream'

  interface Multiplex extends Duplex {
    /** Open a substream toward the peer; `id` is an opaque name echoed to the peer's onStream. */
    createStream(id?: string): Duplex
  }

  function multiplex(onStream?: (stream: Duplex, id: string) => void): Multiplex
  function multiplex(
    opts: Record<string, unknown>,
    onStream?: (stream: Duplex, id: string) => void,
  ): Multiplex

  export default multiplex
}
