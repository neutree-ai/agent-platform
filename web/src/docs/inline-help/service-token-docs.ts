import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

export function getServiceTokenDoc(): string {
  return loadDoc('service-token')
}

export function getServiceTokenDocsHint(): string {
  return i18n.t('docs.inlineHelp.serviceToken.hint')
}
