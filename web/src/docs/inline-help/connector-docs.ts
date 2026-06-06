import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

type ConnectorDocKey = 'slack' | 'wecom' | 'webhook' | 'webhook-relay'

export function getConnectorDoc(type: string): string {
  switch (type as ConnectorDocKey) {
    case 'slack':
      return loadDoc('connector-slack')
    case 'wecom':
      return loadDoc('connector-wecom')
    case 'webhook':
      return loadDoc('connector-webhook')
    case 'webhook-relay':
      return loadDoc('connector-webhook-relay')
    default:
      return ''
  }
}

export function getConnectorDocsHint(): string {
  return i18n.t('docs.inlineHelp.connector.hint')
}
