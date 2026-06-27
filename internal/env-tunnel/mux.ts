/// <reference path="./multiplex.d.ts" />
import type { Duplex } from 'node:stream'
import multiplex from 'multiplex'

// A symmetric stream multiplexer over a single duplex byte stream, backed by
// `multiplex` (mafintosh). BOTH ends can open streams — required because forward
// traffic (cp→agent) is opened by the gateway side while reverse traffic
// (agent→cp) is opened by the runner side. Each logical stream is a raw Node
// Duplex of opaque bytes; the mux never parses HTTP/gRPC — substreams pipe
// straight to/from sockets. We use a vetted library rather than hand-rolling
// framing + flow control: backpressure rides Node's stream machinery, and
// substreams being Node Duplexes means zero adapter layer (the main quality
// risk). See tmp/byoi-environments-design.md §6.
//
// This wrapper keeps a tiny stable surface (openStream/onStreamOpen/close) so
// the gateway and tunnel client never touch `multiplex` directly.

export class Mux {
  private readonly plex: ReturnType<typeof multiplex>
  private onStream?: (stream: Duplex, meta: string) => void

  constructor(conn: Duplex) {
    this.plex = multiplex((stream, id) => {
      // A channel that receives data after being destroyed (normal lifecycle —
      // e.g. the peer reset it) emits 'error'; without a listener that would be
      // an uncaught exception and crash the whole cp / runner process. Swallow
      // it here; callers (pipeToTcp) still attach their own teardown handler.
      stream.on('error', () => {})
      this.onStream?.(stream, String(id))
    })
    // mux output → conn, conn input → mux. multiplex namespaces local vs remote
    // channels internally, so there is no id-collision concern between ends.
    conn.pipe(this.plex).pipe(conn)
    conn.on('error', () => this.plex.destroy())
    conn.on('close', () => this.plex.destroy())
  }

  /** Register a handler for streams the peer opens. */
  onStreamOpen(cb: (stream: Duplex, meta: string) => void): void {
    this.onStream = cb
  }

  /** Open a new stream toward the peer, tagged with an opaque target meta. */
  openStream(meta: string): Duplex {
    const stream = this.plex.createStream(meta)
    stream.on('error', () => {}) // see note in constructor — never let it crash.
    return stream
  }

  close(): void {
    this.plex.destroy()
  }
}
