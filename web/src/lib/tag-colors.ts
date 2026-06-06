import { i18n } from '@/lib/i18n'

interface TagColor {
  key: string
  bg: string
  text: string
  label: string
}

export const TAG_COLORS: TagColor[] = [
  {
    key: 'slate',
    bg: 'bg-tag-slate',
    text: 'text-tag-slate',
    label: i18n.t('components.tags.colors.slate'),
  },
  {
    key: 'rose',
    bg: 'bg-tag-rose',
    text: 'text-tag-rose',
    label: i18n.t('components.tags.colors.rose'),
  },
  {
    key: 'amber',
    bg: 'bg-tag-amber',
    text: 'text-tag-amber',
    label: i18n.t('components.tags.colors.amber'),
  },
  {
    key: 'emerald',
    bg: 'bg-tag-emerald',
    text: 'text-tag-emerald',
    label: i18n.t('components.tags.colors.emerald'),
  },
  {
    key: 'sky',
    bg: 'bg-tag-sky',
    text: 'text-tag-sky',
    label: i18n.t('components.tags.colors.sky'),
  },
  {
    key: 'violet',
    bg: 'bg-tag-violet',
    text: 'text-tag-violet',
    label: i18n.t('components.tags.colors.violet'),
  },
  {
    key: 'orange',
    bg: 'bg-tag-orange',
    text: 'text-tag-orange',
    label: i18n.t('components.tags.colors.orange'),
  },
  {
    key: 'pink',
    bg: 'bg-tag-pink',
    text: 'text-tag-pink',
    label: i18n.t('components.tags.colors.pink'),
  },
]

const colorMap = new Map(TAG_COLORS.map((c) => [c.key, c]))

export function getTagColor(key: string): TagColor {
  return colorMap.get(key) || TAG_COLORS[0]
}
