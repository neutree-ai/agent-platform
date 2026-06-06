import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

export function getMemoryStoreDoc(): string {
  return loadDoc('memory-store')
}

export function getMemoryStoreDocsHint(): string {
  return i18n.t('docs.inlineHelp.memoryStore.hint')
}
