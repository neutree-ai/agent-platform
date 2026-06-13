// The package owns its own i18next instance so it is drop-in for any host —
// including ones (like Mission Control) that have no i18next of their own. The
// render components use react-i18next's `useTranslation()`; wrapping them in
// <TranscriptI18nProvider> rebinds that hook to this private instance, leaving
// the host's own i18next (if any) untouched.
//
// Strings keep their original `components.chat.*` key paths so the moved
// components need no key rewrites; the bundle below is just that subtree.
import i18next, { type i18n as I18nInstance } from 'i18next'
import { type ReactNode, useEffect } from 'react'
import { I18nextProvider, getI18n, initReactI18next, setI18n } from 'react-i18next'
import enUS from './locales/en-US.json'
import zhCN from './locales/zh-CN.json'

export const transcriptI18n: I18nInstance = i18next.createInstance()

// initReactI18next.init() has a side effect: setI18n(instance) makes the passed
// instance react-i18next's GLOBAL default — the one bare useTranslation() falls
// back to outside any <I18nextProvider>. Letting our private, chat-only instance
// become the global clobbers the host app's i18n (every non-wrapped key renders
// raw). Capture the host's global before init and restore it after: our own
// components reach transcriptI18n through <TranscriptI18nProvider> (context),
// which takes precedence over the global, so they are unaffected by the restore.
const hostI18n = getI18n()
void transcriptI18n.use(initReactI18next).init({
  resources: {
    'en-US': { translation: enUS },
    'zh-CN': { translation: zhCN },
  },
  lng: 'en-US',
  fallbackLng: 'en-US',
  supportedLngs: ['en-US', 'zh-CN'],
  load: 'currentOnly',
  interpolation: { escapeValue: false },
})
if (hostI18n) setI18n(hostI18n)

// Normalize anything zh-ish to our zh-CN bundle, everything else to en-US.
function normalizeLocale(locale: string | undefined): 'en-US' | 'zh-CN' {
  return locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export interface TranscriptI18nProviderProps {
  /** Host locale (e.g. "zh-CN", "en"). Anything zh-* maps to zh-CN. */
  locale?: string
  children: ReactNode
}

export function TranscriptI18nProvider({ locale, children }: TranscriptI18nProviderProps) {
  const target = normalizeLocale(locale)
  useEffect(() => {
    if (transcriptI18n.language !== target) void transcriptI18n.changeLanguage(target)
  }, [target])
  return <I18nextProvider i18n={transcriptI18n}>{children}</I18nextProvider>
}
