import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { DashboardSection } from './DashboardSection'
import { InfraSection } from './InfraSection'
import { SystemSettingsSection } from './SystemSettingsSection'
import { UsersSection } from './UsersSection'

type Section = 'dashboard' | 'users' | 'infra' | 'system'

interface AdminPanelProps {
  instanceId: string
}

export function AdminPanel({ instanceId }: AdminPanelProps) {
  const { t } = useTranslation()
  const [section, setSection] = useInstancePersistentState<Section>(
    instanceId,
    'adminSection',
    () => 'dashboard',
  )
  const headerSlot = useAppHeaderSlot()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {headerSlot &&
        createPortal(
          <Tabs
            value={section}
            onValueChange={(v) => setSection(v as Section)}
            className="shrink-0"
          >
            <TabsList className="h-7 p-0.5">
              <TabsTrigger value="dashboard" className="h-6 px-2 text-xs">
                {t('pages.admin.navigation.dashboard')}
              </TabsTrigger>
              <TabsTrigger value="users" className="h-6 px-2 text-xs">
                {t('pages.admin.navigation.users')}
              </TabsTrigger>
              <TabsTrigger value="infra" className="h-6 px-2 text-xs">
                {t('pages.admin.navigation.infrastructure')}
              </TabsTrigger>
              <TabsTrigger value="system" className="h-6 px-2 text-xs">
                {t('pages.admin.navigation.system')}
              </TabsTrigger>
            </TabsList>
          </Tabs>,
          headerSlot,
        )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {section === 'dashboard' && <DashboardSection instanceId={instanceId} />}
        {section === 'users' && <UsersSection instanceId={instanceId} />}
        {section === 'infra' && <InfraSection instanceId={instanceId} />}
        {section === 'system' && <SystemSettingsSection instanceId={instanceId} />}
      </div>
    </div>
  )
}
