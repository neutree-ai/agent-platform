import { loadDoc } from './_load'

export type PreferencesSection = 'appearance' | 'evolution' | 'notifications' | 'accounts' | 'about'

export function getPreferencesDoc(section: PreferencesSection): string {
  switch (section) {
    case 'appearance':
      return loadDoc('preferences-appearance')
    case 'evolution':
      return loadDoc('preferences-evolution')
    case 'notifications':
      return loadDoc('preferences-notifications')
    case 'accounts':
      return loadDoc('preferences-accounts')
    case 'about':
      return loadDoc('preferences-about')
  }
}
