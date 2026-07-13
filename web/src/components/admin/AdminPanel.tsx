import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ADMIN_SECTIONS, DEFAULT_ADMIN_SECTION } from './registry'

interface AdminPanelProps {
  instanceId: string
}

export function AdminPanel({ instanceId }: AdminPanelProps) {
  const { t } = useTranslation()
  const [section, setSection] = useInstancePersistentState<string>(
    instanceId,
    'adminSection',
    () => DEFAULT_ADMIN_SECTION,
  )
  const headerSlot = useAppHeaderSlot()

  // Fall back to the first section if the persisted id no longer exists
  // (section removed or renamed between releases).
  const active = ADMIN_SECTIONS.find((s) => s.id === section) ?? ADMIN_SECTIONS[0]
  const ActiveComponent = active.Component

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {headerSlot &&
        createPortal(
          <Tabs value={active.id} onValueChange={setSection} className="shrink-0">
            <TabsList className="h-7 p-0.5">
              {ADMIN_SECTIONS.map((s) => (
                <TabsTrigger key={s.id} value={s.id} className="h-6 px-2 text-xs">
                  {t(s.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>,
          headerSlot,
        )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ActiveComponent instanceId={instanceId} />
      </div>
    </div>
  )
}
