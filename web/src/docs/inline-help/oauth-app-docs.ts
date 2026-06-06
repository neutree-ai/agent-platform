import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

export function getOAuthAppDoc(): string {
  return loadDoc('oauth-app')
}

export function getOAuthAppDocsHint(): string {
  return i18n.t('docs.inlineHelp.oauthApp.hint')
}
