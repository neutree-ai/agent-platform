import { Button } from '@/components/ui/button'
import { EmptyHero } from '@/components/ui/empty-hero'
import { isChunkLoadError, reloadForStaleChunks } from '@/lib/chunk-reload'
import { RefreshCw } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Recovery card shown when a panel's chunk fails to load and the automatic
 * reload was suppressed (loop guard) — see {@link ChunkErrorBoundary}.
 */
function ChunkErrorFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyHero
        title={t('common.chunkError.title')}
        description={t('common.chunkError.description')}
        action={
          <Button size="sm" onClick={() => window.location.reload()}>
            <RefreshCw /> {t('common.chunkError.reload')}
          </Button>
        }
      />
    </div>
  )
}

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches dynamic-import (chunk-load) failures from `lazy()` panels.
 *
 * When a stale chunk fails, {@link reloadForStaleChunks} reloads the page to
 * pick up fresh hashes. If that reload was already attempted recently (guard),
 * this boundary renders a recovery card instead of letting the rejection
 * white-screen the app. Non-chunk errors are re-thrown unchanged so genuine
 * bugs keep surfacing exactly as before.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      // Last-resort: attempt the reload here too, in case the failure never
      // went through Vite's `vite:preloadError` path (e.g. a non-preloaded
      // import). The guard inside makes this a no-op if a reload just ran.
      reloadForStaleChunks()
    }
  }

  render() {
    const { error } = this.state
    if (error) {
      if (!isChunkLoadError(error)) throw error
      return <ChunkErrorFallback />
    }
    return this.props.children
  }
}
