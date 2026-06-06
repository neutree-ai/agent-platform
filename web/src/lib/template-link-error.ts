import { ApiClientError } from '@/lib/api/client'
import type { TemplateLinkMissingItem } from '@/lib/api/types'
import { i18n } from '@/lib/i18n'

/**
 * Format a template-link-acl violation as a localized string for places
 * that can only show a single line (toast / inline form error). The
 * dedicated TemplateShareDialog has a richer per-row renderer; this helper
 * is for the create-version / rollback paths where no UI is wired up.
 *
 * Falls back to `err.message` for non-link errors so callers can use it as
 * a drop-in replacement for `err.message`.
 */
export function formatTemplateLinkError(err: unknown): string {
  if (err instanceof ApiClientError) {
    const missing = err.body.missing as TemplateLinkMissingItem[] | undefined
    if (missing && missing.length > 0) {
      const lines = missing.map((m) => formatMissingLine(m))
      return [i18n.t('components.templateShare.linkMissing.title'), ...lines].join('\n')
    }
  }
  if (err instanceof Error) return err.message
  return String(err)
}

function formatMissingLine(m: TemplateLinkMissingItem): string {
  const resource = i18n.t(`components.templateShare.linkMissing.${m.resource}` as const)
  const scope =
    m.scope.kind === 'public'
      ? i18n.t('components.templateShare.linkMissing.scopePublic')
      : i18n.t('components.templateShare.linkMissing.scopeTeam', { team: m.scope.team_name })
  return i18n.t('components.templateShare.linkMissing.line', {
    resource,
    name: m.resource_name,
    scope,
  })
}
