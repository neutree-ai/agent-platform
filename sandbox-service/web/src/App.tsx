import { useAuth } from '@/contexts/AuthContext'
import { useConfig } from '@/hooks/useConfig'
import { type SandboxSession, api } from '@/lib/api'
import { BookOpen, Box, Check, Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function CopyBadge({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded text-gray-600 transition-colors"
      title={value}
    >
      {label}
      {copied ? <Check className="h-2.5 w-2.5 text-green-600" /> : <Copy className="h-2.5 w-2.5" />}
    </button>
  )
}

function LoginPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Sandboxes</h1>
          <p className="mt-1 text-sm text-gray-600">{t('loginPage.subtitle')}</p>
        </div>
        <a
          href="/api/auth/login"
          className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          {t('loginPage.loginButton')}
        </a>
      </div>
    </div>
  )
}

const IMAGE_PRESETS = [
  { label: 'Node 22', value: 'node:22-bookworm' },
  { label: 'Python 3.12', value: 'python:3.12-bookworm' },
]

function HomePage() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const config = useConfig()
  const [sessions, setSessions] = useState<SandboxSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/sandboxes\/([^/]+)/)
    return match ? match[1] : null
  })
  const [detail, setDetail] = useState<SandboxSession | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<'empty' | 'detail' | 'create'>(() =>
    window.location.pathname.match(/^\/sandboxes\/[^/]+/) ? 'detail' : 'empty',
  )
  const [createImage, setCreateImage] = useState('node:22-bookworm')
  const [createTimeout, setCreateTimeout] = useState('6h')
  const [createCpu, setCreateCpu] = useState('1')
  const [createMemory, setCreateMemory] = useState('1Gi')

  const navigate = (path: string) => {
    window.history.pushState(null, '', path)
  }

  const loadSessions = useCallback(() => {
    setLoading(true)
    api
      .listSandboxes()
      .then((r) => setSessions(r.items))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigate is stable, omitted to avoid re-renders
  const loadDetail = useCallback((id: string) => {
    setDetailLoading(true)
    navigate(`/sandboxes/${id}`)
    api
      .getSandbox(id)
      .then((s) => {
        setDetail(s)
        setSelectedId(id)
        setMode('detail')
      })
      .catch(() => {
        setDetail(null)
        setSelectedId(null)
        setMode('empty')
        navigate('/')
      })
      .finally(() => setDetailLoading(false))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    loadSessions()
    if (selectedId) loadDetail(selectedId)
  }, []) // eslint-disable-line

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/sandboxes\/([^/]+)/)
      if (match) {
        loadDetail(match[1])
      } else {
        setSelectedId(null)
        setDetail(null)
        setMode('empty')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [loadDetail])

  const parseDuration = (s: string): number => {
    const match = s.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i)
    if (match) {
      const val = Number.parseFloat(match[1])
      switch (match[2].toLowerCase()) {
        case 'd':
          return val * 86400
        case 'h':
          return val * 3600
        case 'm':
          return val * 60
        default:
          return val
      }
    }
    return Number.parseInt(s) || 3600
  }

  const startCreate = () => {
    setMode('create')
    setCreateImage('node:22-bookworm')
    setCreateTimeout('6h')
    setCreateCpu('1')
    setCreateMemory('1Gi')
    setSelectedId(null)
    setDetail(null)
    navigate('/')
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const seconds = Math.max(60, Math.min(86400, parseDuration(createTimeout)))
      const s = await api.createSandbox({
        image: createImage,
        resource: { cpu: createCpu, memory: createMemory },
        timeoutSeconds: seconds,
      })
      setMode('detail')
      loadSessions()
      loadDetail(s.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : t('home.alerts.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('home.alerts.confirmDelete'))) return
    try {
      await api.deleteSandbox(id)
      if (selectedId === id) {
        setSelectedId(null)
        setDetail(null)
        setMode('empty')
        navigate('/')
      }
      loadSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('home.alerts.deleteFailed'))
    }
  }

  const handleRenew = async (id: string) => {
    try {
      const result = await api.renewSandbox(id, 3600)
      if (detail && detail.id === id) {
        setDetail({ ...detail, expiresAt: result.expiresAt })
      }
      loadSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('home.alerts.renewFailed'))
    }
  }

  const formatTime = (iso?: string) => {
    if (!iso) return '-'
    const diff = new Date(iso).getTime() - Date.now()
    if (diff < 0) return t('home.expired')
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
    return `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`
  }

  const statusColor = (state: string) => {
    if (state === 'Running') return 'bg-green-500'
    if (state === 'Pending' || state === 'Allocated') return 'bg-yellow-500'
    return 'bg-gray-400'
  }

  return (
    <div className="flex h-screen">
      {/* Left: Session list */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h1 className="font-bold text-sm">Sandboxes</h1>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">{user?.name}</span>
            <button
              type="button"
              onClick={() => logout()}
              className="text-gray-500 hover:text-gray-700"
            >
              {t('home.logout')}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            type="button"
            onClick={startCreate}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-gray-900 px-2 py-1.5 text-xs text-white hover:bg-gray-800"
          >
            <Plus className="h-3 w-3" />
            {t('home.newSandbox')}
          </button>
          <button
            type="button"
            onClick={loadSessions}
            className="rounded border px-2 py-1.5 text-gray-600 hover:bg-gray-50"
            title={t('home.actions.refresh')}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-center text-xs text-gray-500">{t('home.loading')}</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-center text-xs text-gray-500">{t('home.empty')}</p>
          ) : (
            sessions.map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => loadDetail(s.id)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 ${
                  selectedId === s.id ? 'bg-gray-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${statusColor(s.status.state)}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium font-mono truncate">
                        {s.id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {formatTime(s.expiresAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {s.image?.uri ?? 'unknown'} · {s.status.state}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <a
          href="/api/docs"
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
        >
          <BookOpen className="h-3 w-3" />
          API Reference
        </a>
      </div>

      {/* Right: Detail / Create */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'empty' && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Box className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">{t('home.selectOrCreate')}</p>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <div className="mx-auto max-w-xl px-6 py-6">
            <h2 className="text-lg font-bold mb-4">{t('home.createForm.title')}</h2>
            <div className="space-y-4">
              <div className="rounded border p-3 space-y-3">
                <div>
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: groups multiple presets + free input */}
                  <label className="text-xs text-gray-500">{t('home.createForm.image')}</label>
                  <div className="mt-1 flex gap-2 flex-wrap">
                    {IMAGE_PRESETS.map((p) => (
                      <button
                        type="button"
                        key={p.value}
                        onClick={() => setCreateImage(p.value)}
                        className={`rounded border px-2.5 py-1 text-xs ${
                          createImage === p.value
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={createImage}
                    onChange={(e) => setCreateImage(e.target.value)}
                    className="mt-2 w-full rounded border px-2 py-1 text-xs font-mono outline-none focus:border-gray-400"
                    placeholder="node:22-bookworm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: groups multiple presets + free input */}
                    <label className="text-xs text-gray-500">{t('home.createForm.cpu')}</label>
                    <input
                      type="text"
                      value={createCpu}
                      onChange={(e) => setCreateCpu(e.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs font-mono outline-none focus:border-gray-400"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    {/* biome-ignore lint/a11y/noLabelWithoutControl: groups multiple presets + free input */}
                    <label className="text-xs text-gray-500">{t('home.createForm.memory')}</label>
                    <input
                      type="text"
                      value={createMemory}
                      onChange={(e) => setCreateMemory(e.target.value)}
                      className="mt-1 w-full rounded border px-2 py-1 text-xs font-mono outline-none focus:border-gray-400"
                      placeholder="1Gi"
                    />
                  </div>
                </div>

                <div>
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: groups multiple presets + free input */}
                  <label className="text-xs text-gray-500">{t('home.createForm.timeout')}</label>
                  <div className="mt-1 flex gap-2">
                    {['30m', '1h', '6h', '12h', '24h'].map((v) => (
                      <button
                        type="button"
                        key={v}
                        onClick={() => setCreateTimeout(v)}
                        className={`rounded border px-2.5 py-1 text-xs ${
                          createTimeout === v
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-200 text-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                    <input
                      type="text"
                      value={createTimeout}
                      onChange={(e) => setCreateTimeout(e.target.value)}
                      className="w-16 rounded border px-2 py-1 text-xs font-mono outline-none focus:border-gray-400"
                      placeholder="6h"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{t('home.createForm.timeoutHint')}</p>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setMode('empty')}
                  className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  {t('home.createForm.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !createImage.trim()}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {creating ? t('home.createForm.creating') : t('home.createForm.create')}
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'detail' && detailLoading && (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            {t('home.loading')}
          </div>
        )}

        {mode === 'detail' && !detailLoading && detail && (
          <div className="flex flex-col h-full">
            {/* Top bar */}
            <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusColor(detail.status.state)}`} />
                  <span className="font-mono text-xs font-medium">{detail.id.slice(0, 8)}</span>
                </div>
                <span className="text-xs text-gray-500">{detail.image?.uri}</span>
                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="font-medium">{formatTime(detail.expiresAt)}</span>
                  <button
                    type="button"
                    onClick={() => handleRenew(detail.id)}
                    className="text-gray-500 hover:text-gray-700 ml-0.5"
                    title={t('home.actions.renew')}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
                <CopyBadge label="ID" value={detail.id} />
                <div className="flex items-center border rounded overflow-hidden ml-1">
                  <button
                    type="button"
                    className="flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-900 text-white"
                  >
                    <BookOpen className="h-3 w-3" /> Docs
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(detail.id)}
                className="text-gray-500 hover:text-red-500"
                title={t('home.actions.delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Docs content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-6 py-6">
                <h2 className="text-lg font-bold mb-4">{t('docs.title')}</h2>

                <section className="mb-5 rounded border p-3 bg-gray-50">
                  <h3 className="text-xs font-semibold mb-1">{t('docs.auth.heading')}</h3>
                  <p className="text-xs text-gray-600">
                    {t('docs.auth.description')}{' '}
                    <a
                      href={`${config.napUrl}/integration/tokens`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline hover:text-gray-700 font-medium"
                    >
                      {t('docs.auth.linkLabel')}
                    </a>{' '}
                    {t('docs.auth.descriptionSuffix')}
                  </p>
                </section>

                <section className="mb-6">
                  <h3 className="text-sm font-semibold mb-2">{t('docs.sdk.heading')}</h3>
                  <p className="text-xs text-gray-600 mb-2">
                    {t('docs.sdk.install')}{' '}
                    <code className="bg-gray-100 px-1 rounded">npm install @neutree-ai/sandbox</code>
                    {t('docs.sdk.installSuffix')}
                  </p>
                  <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`import { SandboxClient } from '@neutree-ai/sandbox'

const client = new SandboxClient({
  baseUrl: 'https://sandbox.example.com',  // sandbox service URL
  token: 'tos_...',                         // NAP Service Token
})

// Create a sandbox
const sbx = await client.create({
  image: 'node:22-bookworm',
  resource: { cpu: '1', memory: '1Gi' },
  timeoutSeconds: 21600,  // 6h
})

// Run a command
const result = await client.exec(sbx.id, 'echo "Hello from sandbox"')
console.log(result.stdout)

// Read and write files
await client.writeFiles(sbx.id, [
  { path: '/workspace/index.js', content: 'console.log("hi")' },
])
const content = await client.readFile(sbx.id, '/workspace/index.js')

// Get a preview URL (for dev server)
const previewUrl = client.getPreviewUrl(sbx.id, 3000)
// → https://{id}-3000.${config.sandboxDomain}/

// Destroy
await client.delete(sbx.id)`}</pre>
                  <p className="text-xs text-gray-500 mt-1">
                    <a
                      href="https://www.npmjs.com/package/@neutree-ai/sandbox"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline hover:text-gray-700"
                    >
                      @neutree-ai/sandbox on npm
                    </a>
                  </p>
                </section>

                <section className="mb-6">
                  <h3 className="text-sm font-semibold mb-2">{t('docs.rest.heading')}</h3>
                  <p className="text-xs text-gray-600 mb-2">
                    {t('docs.rest.authHeader')}{' '}
                    <code className="bg-gray-100 px-1 rounded">Authorization: Bearer tos_...</code>
                    {t('docs.rest.authHeaderSuffix')}
                  </p>
                  <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`export TOKEN="tos_..."
BASE="${window.location.origin}"

# Create a sandbox
curl -X POST "$BASE/api/sandboxes" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"image":"node:22-bookworm","resource":{"cpu":"1","memory":"1Gi"},"timeoutSeconds":21600}'

# Run a command
curl -X POST "$BASE/api/sandboxes/${detail.id}/exec" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"echo hello"}'

# Read a file
curl "$BASE/api/sandboxes/${detail.id}/files?path=/etc/hostname" \\
  -H "Authorization: Bearer $TOKEN"

# Get a port preview URL
curl "$BASE/api/sandboxes/${detail.id}/endpoint/3000" \\
  -H "Authorization: Bearer $TOKEN"

# Renew
curl -X POST "$BASE/api/sandboxes/${detail.id}/renew" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"timeoutSeconds":3600}'

# Delete
curl -X DELETE "$BASE/api/sandboxes/${detail.id}" \\
  -H "Authorization: Bearer $TOKEN"`}</pre>
                </section>

                <section className="mb-6">
                  <h3 className="text-sm font-semibold mb-2">{t('docs.preview.heading')}</h3>
                  <p className="text-xs text-gray-600 mb-2">{t('docs.preview.description')}</p>
                  <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`# Start a dev server inside the sandbox (in the background)
curl -X POST "$BASE/api/sandboxes/${detail.id}/exec" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"nohup npx serve -l 3000 /workspace > /tmp/serve.log 2>&1 & echo $!"}'

# Open via subdomain preview (no auth required)
open "https://${detail.id}-3000.${config.sandboxDomain}/"`}</pre>
                </section>

                <section className="mb-6">
                  <h3 className="text-sm font-semibold mb-2">{t('docs.endpoints.heading')}</h3>
                  <div className="bg-gray-50 border rounded p-3 text-xs space-y-2">
                    <div>
                      <span className="text-gray-500">API:</span>{' '}
                      <code>
                        {window.location.origin}/api/sandboxes/{detail.id}
                      </code>
                    </div>
                    <div>
                      <span className="text-gray-500">Preview:</span>{' '}
                      <code>
                        https://{detail.id}-{'<port>'}.{config.sandboxDomain}/
                      </code>
                    </div>
                    <div>
                      <span className="text-gray-500">Status:</span>{' '}
                      <code>{detail.status.state}</code>{' '}
                      {detail.status.reason && (
                        <span className="text-gray-400">({detail.status.reason})</span>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">Created:</span>{' '}
                      <code>
                        {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '-'}
                      </code>
                    </div>
                    <div>
                      <span className="text-gray-500">Expires:</span>{' '}
                      <code>
                        {detail.expiresAt ? new Date(detail.expiresAt).toLocaleString() : '-'}
                      </code>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-gray-500">loading</div>
    )
  }

  return user ? <HomePage /> : <LoginPage />
}
