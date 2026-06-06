import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

type SkillDocKey = 'upload' | 'git'

export function getSkillDoc(key: SkillDocKey): string {
  switch (key) {
    case 'upload':
      return loadDoc('skill-upload')
    case 'git':
      return loadDoc('skill-git')
  }
}

export function getSkillDocsHint(): string {
  return i18n.t('docs.inlineHelp.skill.hint')
}
