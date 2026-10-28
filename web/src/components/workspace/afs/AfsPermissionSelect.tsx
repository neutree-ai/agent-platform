import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AfsPermission } from '@/lib/api/agent-files'
import { useTranslation } from 'react-i18next'

/** The i18n key naming a folder permission. */
export function afsPermissionKey(permission: AfsPermission): string {
  return permission === 'read_only'
    ? 'components.afsShares.perm.ro'
    : 'components.afsShares.perm.rw'
}

interface AfsPermissionSelectProps {
  value: AfsPermission
  onChange: (permission: AfsPermission) => void
  disabled?: boolean
  /** The highest permission offered. */
  max?: AfsPermission
  className?: string
}

export function AfsPermissionSelect({
  value,
  onChange,
  disabled,
  max = 'read_write',
  className = 'w-28',
}: AfsPermissionSelectProps) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AfsPermission)} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="read_only">{t(afsPermissionKey('read_only'))}</SelectItem>
        {max === 'read_write' && (
          <SelectItem value="read_write">{t(afsPermissionKey('read_write'))}</SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
