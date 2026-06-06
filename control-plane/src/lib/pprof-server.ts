import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import * as pprof from '@datadog/pprof'

const PPROF_PORT = Number.parseInt(process.env.PPROF_PORT || '9090')

type PprofProfile = ReturnType<typeof pprof.heap.profile>

async function writeProfile(res: ServerResponse, profile: PprofProfile) {
  const buf = await pprof.encode(profile)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(buf.length),
  })
  res.end(buf)
}

async function handleHeap(res: ServerResponse) {
  await writeProfile(res, pprof.heap.profile())
}

async function handleCpu(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost')
  const seconds = Math.max(1, Math.min(120, Number(url.searchParams.get('seconds') || '30')))
  const profile = (await pprof.time.profile({
    durationMillis: seconds * 1000,
    intervalMicros: 1000,
  })) as PprofProfile
  await writeProfile(res, profile)
}

export function startPprofServer() {
  // Heap allocation sampling — must be started once before any heap.profile() call.
  // 512KiB sampling interval, 64-frame max stack depth.
  pprof.heap.start(512 * 1024, 64)

  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0]
    const route = async () => {
      if (path === '/debug/pprof/heap' || path === '/debug/pprof/allocs') {
        return handleHeap(res)
      }
      if (path === '/debug/pprof/profile') {
        return handleCpu(req, res)
      }
      if (path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    }
    route().catch((err) => {
      console.error('[pprof] handler error:', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
      }
      res.end('internal error')
    })
  })

  server.listen(PPROF_PORT, () => {
    console.log(`[pprof] debug server listening on :${PPROF_PORT}`)
  })

  return server
}
