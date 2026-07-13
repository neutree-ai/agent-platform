import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

type ProviderDocKey =
  | 'openai'
  | 'openai-chat'
  | 'anthropic'
  | 'claude-code-oauth'
  | 'anthropic-oauth'

export function getProviderDoc(type: string): string {
  switch (type as ProviderDocKey) {
    case 'openai':
      return loadDoc('provider-openai')
    case 'openai-chat':
      return loadDoc('provider-openai-chat')
    case 'anthropic':
      return loadDoc('provider-anthropic')
    case 'claude-code-oauth':
      return loadDoc('provider-claude-code-oauth')
    case 'anthropic-oauth':
      return loadDoc('provider-anthropic-oauth')
    default:
      return ''
  }
}

export function getProviderDocsHint(): string {
  return i18n.t('docs.inlineHelp.provider.hint')
}
