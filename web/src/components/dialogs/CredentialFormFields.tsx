import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { WorkspaceMultiSelect } from '@/components/ui/workspace-multi-select'
import { cn } from '@/lib/utils'
import { Eye, EyeOff } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CredPreset = 'custom' | 'ssh-key'
type SshKeyType = 'rsa' | 'ed25519' | 'ecdsa' | 'custom'
type InjectMode = 'env' | 'file'

export interface CredentialForm {
  preset: CredPreset
  sshKeyType: SshKeyType
  name: string
  value: string
  inject: InjectMode
  path: string
  mode: string
  scope: 'global' | 'selected'
  workspaceIds: string[]
}

export type CredentialFormErrors = Partial<{
  name: string
  value: string
  path: string
  workspaceIds: string
}>

export const INITIAL_CREDENTIAL_FORM: CredentialForm = {
  preset: 'custom',
  sshKeyType: 'ed25519',
  name: '',
  value: '',
  inject: 'env',
  path: '',
  mode: '',
  scope: 'global',
  workspaceIds: [],
}

const SSH_KEY_PRESETS: { value: SshKeyType; label: string; name: string; path: string }[] = [
  { value: 'ed25519', label: 'ED25519', name: 'id_ed25519', path: '~/.ssh/id_ed25519' },
  { value: 'rsa', label: 'RSA', name: 'id_rsa', path: '~/.ssh/id_rsa' },
  { value: 'ecdsa', label: 'ECDSA', name: 'id_ecdsa', path: '~/.ssh/id_ecdsa' },
]

const FILE_MODE_PRESETS = [
  { value: '0600', labelKey: 'components.createCredential.fileMode.private' },
  { value: '0400', labelKey: 'components.createCredential.fileMode.readOnly' },
  { value: '0644', labelKey: 'components.createCredential.fileMode.shared' },
  { value: '0755', labelKey: 'components.createCredential.fileMode.executable' },
] as const

function applyCredPreset(preset: CredPreset, keyType?: SshKeyType): CredentialForm {
  if (preset === 'ssh-key') {
    const kt = keyType ?? 'ed25519'
    const info = SSH_KEY_PRESETS.find((p) => p.value === kt)
    return {
      preset,
      sshKeyType: kt,
      name: info?.name ?? '',
      value: '',
      inject: 'file',
      path: info?.path ?? '',
      mode: '0600',
      scope: 'global',
      workspaceIds: [],
    }
  }
  return { ...INITIAL_CREDENTIAL_FORM, preset }
}

function applySshKeyType(form: CredentialForm, kt: SshKeyType): CredentialForm {
  if (kt === 'custom') {
    return { ...form, sshKeyType: 'custom', name: '', path: '' }
  }
  const info = SSH_KEY_PRESETS.find((p) => p.value === kt)!
  return { ...form, sshKeyType: kt, name: info.name, path: info.path }
}

interface CredentialFormFieldsProps {
  form: CredentialForm
  setForm: (next: (prev: CredentialForm) => CredentialForm) => void
  errors?: CredentialFormErrors
  /** Edit mode locks preset / inject choice and tweaks copy. */
  isEditing?: boolean
}

export function CredentialFormFields({
  form,
  setForm,
  errors,
  isEditing,
}: CredentialFormFieldsProps) {
  const { t } = useTranslation()
  const [showValue, setShowValue] = useState(false)

  return (
    <div className="space-y-4">
      {!isEditing && (
        <Field label={t('components.createCredential.fields.preset')}>
          <SegmentedControl
            value={form.preset}
            onValueChange={(v) => setForm(() => applyCredPreset(v))}
            variant="box"
            size="md"
            options={[
              { value: 'custom', label: t('components.createCredential.actions.custom') },
              { value: 'ssh-key', label: t('components.createCredential.actions.sshKey') },
            ]}
          />
        </Field>
      )}

      {!isEditing && form.preset === 'ssh-key' && (
        <Field label={t('components.createCredential.fields.sshKeyType')}>
          <SegmentedControl
            value={form.sshKeyType}
            onValueChange={(v) => setForm((f) => applySshKeyType(f, v))}
            variant="box"
            size="md"
            options={[
              ...SSH_KEY_PRESETS.map((p) => ({ value: p.value, label: p.label })),
              {
                value: 'custom' as const,
                label: t('components.createCredential.actions.custom'),
              },
            ]}
          />
        </Field>
      )}

      <Field
        label={t('components.createCredential.fields.name')}
        error={errors?.name}
        htmlFor="cred-name"
      >
        <Input
          id="cred-name"
          className="h-9 text-sm font-mono"
          placeholder={
            form.inject === 'env'
              ? t('components.createCredential.placeholders.envName')
              : t('components.createCredential.placeholders.fileName')
          }
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </Field>

      {form.preset === 'custom' && !isEditing && (
        <Field label={t('components.createCredential.fields.injectionMode')}>
          <Select
            value={form.inject}
            onValueChange={(v) =>
              setForm((f) => ({
                ...f,
                inject: v as InjectMode,
                path: v === 'env' ? '' : f.path,
                mode: v === 'env' ? '' : f.mode,
              }))
            }
          >
            <SelectTrigger className="h-9 text-sm focus:ring-inset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="env"
                description={t('components.createCredential.injectModes.env.desc')}
              >
                {t('components.createCredential.injectModes.env.label')}
              </SelectItem>
              <SelectItem
                value="file"
                description={t('components.createCredential.injectModes.file.desc')}
              >
                {t('components.createCredential.injectModes.file.label')}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {form.inject === 'file' && (
        <>
          <Field
            label={t('components.createCredential.fields.filePath')}
            error={errors?.path}
            htmlFor="cred-path"
          >
            <Input
              id="cred-path"
              className="h-9 text-sm font-mono"
              placeholder={t('components.createCredential.placeholders.filePath')}
              value={form.path}
              onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
            />
          </Field>

          <Field label={t('components.createCredential.fields.fileMode')}>
            <Select
              value={
                FILE_MODE_PRESETS.some((p) => p.value === form.mode) ? form.mode : '__custom__'
              }
              onValueChange={(v) =>
                setForm((f) => ({ ...f, mode: v === '__custom__' ? f.mode : v }))
              }
            >
              <SelectTrigger className="h-9 text-sm focus:ring-inset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILE_MODE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value} description={t(`${p.labelKey}.desc`)}>
                    <span className="font-mono">{p.value}</span>
                    <span className="ml-2 text-muted-foreground">{t(`${p.labelKey}.label`)}</span>
                  </SelectItem>
                ))}
                <SelectItem
                  value="__custom__"
                  description={t('components.createCredential.fileMode.custom.desc')}
                >
                  {t('components.createCredential.fileMode.custom.label')}
                </SelectItem>
              </SelectContent>
            </Select>
            {!FILE_MODE_PRESETS.some((p) => p.value === form.mode) && (
              <Input
                className="mt-2 h-9 text-sm font-mono"
                placeholder={t('components.createCredential.placeholders.fileMode')}
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
              />
            )}
          </Field>
        </>
      )}

      <Field label={t('components.createCredential.fields.scope')}>
        <SegmentedControl
          value={form.scope}
          onValueChange={(v) => setForm((f) => ({ ...f, scope: v, workspaceIds: [] }))}
          variant="box"
          size="md"
          options={[
            { value: 'global' as const, label: t('components.createCredential.scope.global') },
            { value: 'selected' as const, label: t('components.createCredential.scope.selected') },
          ]}
        />
      </Field>

      {form.scope === 'selected' && (
        <Field
          label={t('components.createCredential.fields.workspaces')}
          error={errors?.workspaceIds}
        >
          <WorkspaceMultiSelect
            value={form.workspaceIds}
            onChange={(ids) => setForm((f) => ({ ...f, workspaceIds: ids }))}
          />
        </Field>
      )}

      <Field
        label={t('components.createCredential.fields.value')}
        error={errors?.value}
        htmlFor="cred-value"
        accessory={
          form.value ? (
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
              onClick={() => setShowValue((v) => !v)}
              aria-label={t(
                showValue
                  ? 'components.createCredential.actions.hideValue'
                  : 'components.createCredential.actions.showValue',
              )}
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : undefined
        }
      >
        <Textarea
          id="cred-value"
          className={cn('min-h-[72px] resize-none text-sm font-mono')}
          style={
            !showValue && form.value
              ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
              : undefined
          }
          placeholder={
            isEditing
              ? t('components.credentialsSection.placeholders.editValue')
              : form.inject === 'env'
                ? t('components.createCredential.placeholders.envValue')
                : t('components.createCredential.placeholders.fileValue')
          }
          value={form.value}
          onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
        />
      </Field>
    </div>
  )
}

function Field({
  label,
  error,
  htmlFor,
  accessory,
  children,
}: {
  label: string
  error?: string
  htmlFor?: string
  accessory?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {accessory}
      </div>
      {children}
      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  )
}

export function validateCredentialForm(form: CredentialForm): CredentialFormErrors {
  const errors: CredentialFormErrors = {}
  if (!form.name) errors.name = 'components.createCredential.errors.nameRequired'
  if (!form.value) errors.value = 'components.createCredential.errors.valueRequired'
  if (form.inject === 'file' && !form.path) {
    errors.path = 'components.createCredential.errors.pathRequired'
  }
  if (form.scope === 'selected' && form.workspaceIds.length === 0) {
    errors.workspaceIds = 'components.createCredential.errors.workspacesRequired'
  }
  return errors
}
