import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

export function getRouteDoc(connectorType: string): string {
  switch (connectorType) {
    case 'slack':
      return loadDoc('route-slack')
    case 'wecom':
      return loadDoc('route-wecom')
    case 'webhook':
      return loadDoc('route-webhook')
    default:
      return loadDoc('route-overview')
  }
}

export function getRouteDocsHint(): string {
  return i18n.t('docs.inlineHelp.route.hint')
}
