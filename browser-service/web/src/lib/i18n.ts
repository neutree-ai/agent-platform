import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const localeModules = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*.json', {
  eager: true,
})

const resources = Object.entries(localeModules).reduce(
  (acc, [path, module]) => {
    const locale = path.match(/\.\.\/locales\/(.+)\.json$/)?.[1]
    if (locale) {
      acc[locale] = { translation: module.default }
    }
    return acc
  },
  {} as Record<string, { translation: Record<string, unknown> }>,
)

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en-US',
    load: 'currentOnly',
    debug: false,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'tos-language',
      convertDetectedLanguage: (lng: string) =>
        lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  })

export { i18n }
export default i18n
