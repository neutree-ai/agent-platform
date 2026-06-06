import cronstrue from 'cronstrue/i18n'

/**
 * Render a cron expression as a natural-language string in the active UI
 * locale. Returns null on parse failure so callers can decide whether to
 * fall back to the raw expression (cards) or surface an error (editor).
 *
 * Centralised here so any surface that displays a schedule (cards,
 * tooltips, audit logs) gives the same wording instead of each call site
 * reinventing locale mapping + 24-hour formatting.
 */
export function describeCron(cron: string, language: string): string | null {
  try {
    return cronstrue.toString(cron, {
      locale: cronstrueLocale(language),
      use24HourTimeFormat: true,
    })
  } catch {
    return null
  }
}

function cronstrueLocale(language: string): string {
  if (language?.toLowerCase().startsWith('zh')) return 'zh_CN'
  return 'en'
}
