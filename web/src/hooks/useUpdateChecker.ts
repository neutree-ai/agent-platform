import { api } from '@/lib/api/client'
import { APP_VERSION } from '@/lib/version'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const POLL_INTERVAL_MS = 5 * 60 * 1000

// Polls /api/version and prompts the user to reload when the server reports
// a different commit than the one this bundle was built from. Skips when the
// bundle is an unstamped dev build — version mismatch would fire constantly.
export function useUpdateChecker() {
  const { t } = useTranslation()
  const notifiedRef = useRef(false)

  useEffect(() => {
    if (APP_VERSION === 'dev') return

    let cancelled = false

    async function check() {
      try {
        const { commit } = await api.getVersion()
        if (cancelled || notifiedRef.current) return
        if (commit && commit !== 'dev' && commit !== APP_VERSION) {
          notifiedRef.current = true
          toast.info(t('components.updateAvailable.message'), {
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: t('components.updateAvailable.reload'),
              onClick: () => window.location.reload(),
            },
          })
        }
      } catch {
        // silent — server might be momentarily unavailable
      }
    }

    void check()
    const id = window.setInterval(check, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [t])
}
