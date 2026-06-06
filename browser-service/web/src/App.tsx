import { useAuth } from '@/contexts/AuthContext'
import { useConfig } from '@/hooks/useConfig'
import { type BrowserSession, api } from '@/lib/api'
import { BookOpen, Check, Copy, Globe, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function LiveViewEmbed({ sandboxId }: { sandboxId: string }) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    let cancelled = false

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`/live/${sandboxId}/`, { credentials: 'include' })
          if (!cancelled && res.ok && res.headers.get('content-type')?.includes('html')) {
            setReady(true)
            return
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000))
      }
    }

    poll()
    return () => {
      cancelled = true
    }
  }, [sandboxId])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-block h-5 w-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mb-2" />
          <p className="text-xs text-gray-500">{t('liveView.connecting')}</p>
        </div>
      </div>
    )
  }

  return (
    <iframe
      title="Browser session"
      src={`/live/${sandboxId}/?usr=admin&pwd=admin`}
      className="w-full h-full border-0"
      allow="clipboard-read; clipboard-write"
    />
  )
}

function CopyBadge({
  label,
  value,
  getValue,
}: { label: string; value?: string; getValue?: () => Promise<string> }) {
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const handleCopy = async () => {
    try {
      setLoading(true)
      const text = getValue ? await getValue() : (value ?? '')
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded text-gray-600 transition-colors disabled:opacity-50"
      title={value || label}
    >
      {label}
      {loading ? (
        <div className="h-2.5 w-2.5 border border-gray-400 border-t-gray-600 rounded-full animate-spin" />
      ) : copied ? (
        <Check className="h-2.5 w-2.5 text-green-600" />
      ) : (
        <Copy className="h-2.5 w-2.5" />
      )}
    </button>
  )
}

function LoginPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Browsers</h1>
          <p className="mt-1 text-sm text-gray-600">{t('loginPage.tagline')}</p>
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

function HomePage() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const config = useConfig()
  const [sessions, setSessions] = useState<BrowserSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const path = window.location.pathname
    const match = path.match(/^\/browsers\/([^/]+)/)
    return match ? match[1] : null
  })
  const [detail, setDetail] = useState<BrowserSession | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [mode, setMode] = useState<'empty' | 'detail' | 'create'>(() => {
    return window.location.pathname.match(/^\/browsers\/[^/]+/) ? 'detail' : 'empty'
  })
  const [createTimeout, setCreateTimeout] = useState('1h')
  const [tab, setTab] = useState<'live' | 'docs'>('live')

  const navigate = (path: string) => {
    window.history.pushState(null, '', path)
  }

  const loadSessions = useCallback(() => {
    setLoading(true)
    api
      .listBrowsers()
      .then((r) => setSessions(r.items))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigate is stable, omitted to avoid re-renders
  const loadDetail = useCallback((id: string) => {
    setDetailLoading(true)
    navigate(`/browsers/${id}`)
    api
      .getBrowser(id)
      .then((s) => {
        setDetail(s)
        setSelectedId(id)
        setMode('detail')
        setTab('live')
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
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/browsers\/([^/]+)/)
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
    const match = s.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/i)
    if (match) {
      const val = Number.parseFloat(match[1])
      switch (match[2].toLowerCase()) {
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
    setCreateTimeout('1h')
    setSelectedId(null)
    setDetail(null)
    navigate('/')
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const seconds = Math.max(60, Math.min(86400, parseDuration(createTimeout)))
      const s = await api.createBrowser({ timeout_seconds: seconds })
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
      await api.deleteBrowser(id)
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
      const result = await api.renewBrowser(id, 3600)
      if (detail && detail.id === id) {
        setDetail({ ...detail, expires_at: result.expires_at })
      }
      loadSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('home.alerts.renewFailed'))
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = d.getTime() - now.getTime()
    if (diff < 0) return t('home.expiredLabel')
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`
    return `${Math.floor(diff / 3600_000)}h ${Math.floor((diff % 3600_000) / 60_000)}m`
  }

  const statusColor = (status: string) => {
    if (status === 'Running') return 'bg-green-500'
    if (status === 'Pending') return 'bg-yellow-500'
    return 'bg-gray-400'
  }

  return (
    <div className="flex h-screen">
      {/* Left: Session list */}
      <div className="w-80 shrink-0 border-r flex flex-col">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h1 className="font-bold text-sm">Browsers</h1>
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
            {t('home.newBrowser')}
          </button>
          <button
            type="button"
            onClick={loadSessions}
            className="rounded border px-2 py-1.5 text-gray-600 hover:bg-gray-50"
            title={t('home.refresh')}
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-center text-xs text-gray-500">{t('home.loading')}</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-center text-xs text-gray-500">{t('home.noBrowsers')}</p>
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
                  <span className={`h-2 w-2 rounded-full shrink-0 ${statusColor(s.status)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium font-mono truncate">
                        {s.id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {formatTime(s.expires_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{s.status}</p>
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
              <Globe className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">{t('home.emptyHint')}</p>
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
                  <label className="text-xs text-gray-500">
                    {t('home.createForm.timeoutLabel')}
                  </label>
                  <div className="mt-1 flex gap-2">
                    {['10m', '30m', '1h', '6h', '24h'].map((v) => (
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
                      placeholder="1h"
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
                  disabled={creating}
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
                  <span className={`h-2 w-2 rounded-full ${statusColor(detail.status)}`} />
                  <span className="font-mono text-xs font-medium">{detail.id.slice(0, 8)}</span>
                </div>
                <div
                  className="flex items-center gap-1 text-xs text-gray-600"
                  title={`${t('home.detail.expiresLabel')} ${new Date(detail.expires_at).toLocaleString()}\n${t('home.detail.createdLabel')} ${new Date(detail.created_at).toLocaleString()}`}
                >
                  <span className="font-medium">{formatTime(detail.expires_at)}</span>
                  <button
                    type="button"
                    onClick={() => handleRenew(detail.id)}
                    className="text-gray-500 hover:text-gray-700 ml-0.5"
                    title={t('home.renewTitle')}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
                <CopyBadge label="CDP HTTP" value={`${window.location.origin}/cdp/${detail.id}/`} />
                <CopyBadge
                  label="CDP WSS"
                  getValue={async () => {
                    const res = await fetch(`/cdp/${detail.id}/json/version`, {
                      credentials: 'include',
                    })
                    const data = await res.json()
                    return (data.webSocketDebuggerUrl || '').replace(/\?token=[^&]*/, '')
                  }}
                />
                <CopyBadge label="REC" value={`${window.location.origin}/rec/${detail.id}/`} />
                <div className="flex items-center border rounded overflow-hidden ml-1">
                  <button
                    type="button"
                    onClick={() => setTab('live')}
                    className={`flex items-center gap-1 px-2 py-0.5 text-xs ${tab === 'live' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    <Monitor className="h-3 w-3" /> Live
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('docs')}
                    className={`flex items-center gap-1 px-2 py-0.5 text-xs ${tab === 'docs' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                  >
                    <BookOpen className="h-3 w-3" /> Docs
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(detail.id)}
                className="text-gray-500 hover:text-red-500"
                title={t('home.deleteTitle')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Content area */}
            <div className="flex-1">
              {tab === 'live' && <LiveViewEmbed sandboxId={detail.id} />}
              {tab === 'docs' && (
                <div className="max-w-2xl mx-auto px-6 py-6 overflow-y-auto h-full">
                  <h2 className="text-lg font-bold mb-4">{t('docs.title')}</h2>

                  <section className="mb-5 rounded border p-3 bg-gray-50">
                    <h3 className="text-xs font-semibold mb-1">{t('docs.auth.heading')}</h3>
                    <p className="text-xs text-gray-600">
                      {t('docs.auth.description')}{' '}
                      <a
                        href={`${config.tosUrl}/integration/tokens`}
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
                    <h3 className="text-sm font-semibold mb-2">{t('docs.agentBrowser.heading')}</h3>
                    <p className="text-xs text-gray-600 mb-2">
                      {t('docs.agentBrowser.description')}
                    </p>
                    <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`export TOKEN="tos_..."

# 1. Fetch the WSS Debugger URL (the token is embedded in the returned URL)
WSS=$(curl -s -H "Authorization: Bearer $TOKEN" \\
  ${window.location.origin}/cdp/${detail.id}/json/version | jq -r .webSocketDebuggerUrl)

# 2. Connect and operate via --cdp (every command needs --cdp)
agent-browser --cdp "$WSS" open https://example.com
agent-browser --cdp "$WSS" snapshot
agent-browser --cdp "$WSS" screenshot /tmp/page.png
agent-browser --cdp "$WSS" click "button.submit"`}</pre>
                    <p className="text-xs text-gray-500 mt-1">
                      <a
                        href="https://www.npmjs.com/package/agent-browser"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline hover:text-gray-700"
                      >
                        agent-browser on npm
                      </a>
                      {' · '}
                      <a
                        href="https://github.com/vercel-labs/agent-browser"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline hover:text-gray-700"
                      >
                        GitHub
                      </a>
                    </p>
                  </section>

                  <section className="mb-6">
                    <h3 className="text-sm font-semibold mb-2">{t('docs.playwright.heading')}</h3>
                    <p className="text-xs text-gray-600 mb-2">{t('docs.playwright.description')}</p>
                    <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`import { chromium } from 'playwright';

const TOKEN = 'tos_...'; // Service Token created on the NAP platform

const browser = await chromium.connectOverCDP(
  '${window.location.origin}/cdp/${detail.id}/',
  { headers: { Authorization: \`Bearer \${TOKEN}\` } }
);
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();

await page.goto('https://example.com');
console.log(await page.title());

await browser.close();`}</pre>
                    <p className="text-xs text-gray-500 mt-1">
                      <a
                        href="https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline hover:text-gray-700"
                      >
                        {t('docs.playwrightDocsLink')}
                      </a>
                    </p>
                  </section>

                  <section className="mb-6">
                    <h3 className="text-sm font-semibold mb-2">{t('docs.recording.heading')}</h3>
                    <p className="text-xs text-gray-600 mb-2">{t('docs.recording.description')}</p>
                    <pre className="bg-gray-50 border rounded p-3 text-xs overflow-x-auto whitespace-pre">{`export TOKEN="tos_..."
REC="${window.location.origin}/rec/${detail.id}"
AUTH="Authorization: Bearer $TOKEN"

# Start recording
curl -X POST -H "$AUTH" $REC/recording/start

# ... run automation ...

# Stop and download
curl -X POST -H "$AUTH" $REC/recording/stop
curl -H "$AUTH" $REC/recording/download -o recording.mp4

# Screenshot
curl -X POST -H "$AUTH" $REC/computer/screenshot -o screenshot.png`}</pre>
                    <p className="text-xs text-gray-500 mt-1">
                      <a
                        href="https://github.com/onkernel/kernel-images"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline hover:text-gray-700"
                      >
                        kernel-images on GitHub
                      </a>
                    </p>
                  </section>

                  <section className="mb-6">
                    <h3 className="text-sm font-semibold mb-2">{t('docs.endpoints.heading')}</h3>
                    <div className="bg-gray-50 border rounded p-3 text-xs space-y-2">
                      <div>
                        <span className="text-gray-500">CDP HTTP:</span>{' '}
                        <code>
                          {window.location.origin}/cdp/{detail.id}/
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-500">WSS Debugger:</span>{' '}
                        <code>{t('docs.endpoints.wssHint')}</code>
                      </div>
                      <div>
                        <span className="text-gray-500">Live View:</span>{' '}
                        <code>
                          {window.location.origin}/live/{detail.id}/
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-500">{t('docs.recording.heading')}:</span>{' '}
                        <code>
                          {window.location.origin}/rec/{detail.id}/
                        </code>
                      </div>
                    </div>
                  </section>
                </div>
              )}
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
