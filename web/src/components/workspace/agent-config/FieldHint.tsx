import { Badge } from '@/components/ui/badge'
import { GitBranch, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Shared template layering indicator for agent config fields.
 *
 * Two states:
 * - Inherited: value matches template → green badge
 * - Modified: value differs → amber badge with revert action
 *
 * Renders nothing when there's no template.
 */
export function FieldHint({
  current,
  template,
  onRevert,
  compare,
}: {
  current: unknown
  template: unknown
  onRevert: () => void
  compare?: (a: unknown, b: unknown) => boolean
}) {
  const { t } = useTranslation()
  if (template === undefined) return null

  const matches = compare ? compare(current, template) : normalize(current) === normalize(template)

  if (matches) {
    return (
      <Badge
        variant="outline"
        className="h-5 gap-1 px-1.5 text-mini border-success/30 bg-success/10 text-success cursor-default"
      >
        <GitBranch className="h-3 w-3" />
        {t('components.agentConfigFieldHint.inherited')}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="h-5 gap-1 px-1.5 text-mini border-warning/30 bg-warning/10 text-warning cursor-pointer"
      onClick={onRevert}
    >
      <Pencil className="h-3 w-3" />
      {t('components.agentConfigFieldHint.overridden')}
    </Badge>
  )
}

function normalize(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** Compare JSON strings ignoring formatting differences. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  try {
    return (
      JSON.stringify(JSON.parse(String(a || '{}'))) ===
      JSON.stringify(JSON.parse(String(b || '{}')))
    )
  } catch {
    return String(a || '') === String(b || '')
  }
}

/** Compare ComputeResources objects field-by-field. */
export function resourcesEqual(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  const ra = a as Record<string, string>
  const rb = b as Record<string, string>
  for (const key of ['cpu_request', 'cpu_limit', 'memory_request', 'memory_limit', 'storage']) {
    if ((ra[key] || '') !== (rb[key] || '')) return false
  }
  return true
}
