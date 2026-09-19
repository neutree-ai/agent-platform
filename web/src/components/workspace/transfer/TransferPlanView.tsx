import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import type {
  ApiTransferPlan,
  TransferAction,
  TransferCopySelection,
  TransferItem,
  TransferItemKind,
} from '@/lib/api/types'
import { Ban } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const ACTION_VARIANT: Record<TransferAction, BadgeProps['variant']> = {
  move: 'info-soft',
  copy: 'info-soft',
  eject: 'info-soft',
  keep: 'muted-soft',
  detach: 'warning-soft',
  replace: 'warning-soft',
  remove: 'warning-soft',
  revoke: 'warning-soft',
  block: 'destructive-soft',
  notice: 'muted-soft',
}

const ACTION_LABEL: Record<TransferAction, string> = {
  move: 'components.workspaceTransfer.actions.move',
  copy: 'components.workspaceTransfer.actions.copy',
  eject: 'components.workspaceTransfer.actions.eject',
  keep: 'components.workspaceTransfer.actions.keep',
  detach: 'components.workspaceTransfer.actions.detach',
  replace: 'components.workspaceTransfer.actions.replace',
  remove: 'components.workspaceTransfer.actions.remove',
  revoke: 'components.workspaceTransfer.actions.revoke',
  block: 'components.workspaceTransfer.actions.block',
  notice: 'components.workspaceTransfer.actions.notice',
}

const ITEM_LABEL: Record<TransferItemKind, string> = {
  files: 'components.workspaceTransfer.items.files',
  sessions: 'components.workspaceTransfer.items.sessions',
  schedules: 'components.workspaceTransfer.items.schedules',
  mcp_config: 'components.workspaceTransfer.items.mcp_config',
  inline_api_key: 'components.workspaceTransfer.items.inline_api_key',
  memory_store: 'components.workspaceTransfer.items.memory_store',
  provider: 'components.workspaceTransfer.items.provider',
  prompt: 'components.workspaceTransfer.items.prompt',
  skill: 'components.workspaceTransfer.items.skill',
  template: 'components.workspaceTransfer.items.template',
  environment: 'components.workspaceTransfer.items.environment',
  afs_share: 'components.workspaceTransfer.items.afs_share',
  teamwork_task: 'components.workspaceTransfer.items.teamwork_task',
  tag: 'components.workspaceTransfer.items.tag',
  credential_binding: 'components.workspaceTransfer.items.credential_binding',
  export_link: 'components.workspaceTransfer.items.export_link',
  channel_route: 'components.workspaceTransfer.items.channel_route',
  recipient_credentials: 'components.workspaceTransfer.items.recipient_credentials',
  mcp_oauth: 'components.workspaceTransfer.items.mcp_oauth',
  slug_reference: 'components.workspaceTransfer.items.slug_reference',
}

type Group = 'moves' | 'keeps' | 'drops' | 'notices'

const GROUP_LABEL: Record<Group, string> = {
  moves: 'components.workspaceTransfer.groups.moves',
  drops: 'components.workspaceTransfer.groups.drops',
  keeps: 'components.workspaceTransfer.groups.keeps',
  notices: 'components.workspaceTransfer.groups.notices',
}

function groupOf(action: TransferAction): Group | null {
  switch (action) {
    case 'move':
    case 'copy':
    case 'eject':
      return 'moves'
    case 'keep':
      return 'keeps'
    case 'detach':
    case 'replace':
    case 'remove':
    case 'revoke':
      return 'drops'
    case 'notice':
      return 'notices'
    case 'block':
      return null
  }
}

const GROUPS: Group[] = ['moves', 'drops', 'keeps', 'notices']

interface TransferPlanViewProps {
  plan: ApiTransferPlan
  /**
   * The sender's copy selection. With `onCopyChange`, private prompts / skills
   * get a checkbox to toggle copy vs detach; without, the plan's own actions
   * are shown as they are.
   */
  copy?: TransferCopySelection
  onCopyChange?: (copy: TransferCopySelection) => void
}

/** What a transfer does, grouped by effect. Shared by the sender, recipient and admin views. */
export function TransferPlanView({ plan, copy, onCopyChange }: TransferPlanViewProps) {
  const { t } = useTranslation()
  const copyable = new Set([
    ...plan.copyable.prompts.map((p) => p.id),
    ...plan.copyable.skills.map((s) => s.id),
  ])

  const effectiveAction = (item: TransferItem): TransferAction => {
    if (!copy || !item.id || !copyable.has(item.id)) return item.action
    if (item.kind === 'prompt') return copy.prompts.includes(item.id) ? 'copy' : 'detach'
    if (item.kind === 'skill') return copy.skills.includes(item.id) ? 'copy' : 'detach'
    return item.action
  }

  const toggle = (item: TransferItem, checked: boolean) => {
    if (!copy || !onCopyChange || !item.id) return
    const key = item.kind === 'prompt' ? 'prompts' : 'skills'
    const next = checked ? [...copy[key], item.id] : copy[key].filter((id) => id !== item.id)
    onCopyChange({ ...copy, [key]: next })
  }

  const blockers = plan.items.filter((i) => i.action === 'block')

  return (
    <div className="flex flex-col gap-3">
      {blockers.map((item) => (
        <Alert key={`${item.kind}:${item.id}`} variant="destructive">
          <Ban className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {t('components.workspaceTransfer.blocked.environment', { name: item.name ?? '' })}
          </AlertDescription>
        </Alert>
      ))}
      {GROUPS.map((group) => {
        const items = plan.items.filter((i) => groupOf(effectiveAction(i)) === group)
        if (items.length === 0) return null
        return (
          <div key={group} className="flex flex-col gap-1.5">
            <div className="text-mini font-medium uppercase tracking-wide text-muted-foreground">
              {t(GROUP_LABEL[group])}
            </div>
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const action = effectiveAction(item)
                const editable =
                  !!onCopyChange &&
                  !!item.id &&
                  copyable.has(item.id) &&
                  (item.kind === 'prompt' || item.kind === 'skill')
                return (
                  <li
                    key={`${item.kind}:${item.id ?? ''}:${item.name ?? ''}`}
                    className="flex items-start gap-2 text-xs"
                  >
                    <Badge
                      variant={ACTION_VARIANT[action]}
                      className="mt-px shrink-0 px-1.5 py-0 text-mini font-medium"
                    >
                      {t(ACTION_LABEL[action])}
                    </Badge>
                    <span className="min-w-0 flex-1 text-foreground">
                      {t(ITEM_LABEL[item.kind], {
                        name: item.name ?? '',
                        count: item.count ?? 0,
                      })}
                    </span>
                    {editable && (
                      <label className="flex shrink-0 items-center gap-1.5 text-mini text-muted-foreground">
                        <Checkbox
                          className="h-3.5 w-3.5"
                          checked={action === 'copy'}
                          onCheckedChange={(v) => toggle(item, v === true)}
                        />
                        {t('components.workspaceTransfer.copyToRecipient')}
                      </label>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
