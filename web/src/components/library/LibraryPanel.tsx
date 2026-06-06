import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInstancePersistentState } from '@/stores/instance-state-store'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PromptsSection } from './PromptsSection'
import { SkillsSection } from './SkillsSection'
import { TemplatesSection } from './TemplatesSection'

type Section = 'prompts' | 'skills' | 'templates'

interface LibraryPanelProps {
  instanceId: string
}

/**
 * Hosts prompts / skills / templates in a single workspace-shell app
 * instance. The active sub-section is per-instance persistent so refresh
 * lands the user back on the section they were in. Each sub-section owns
 * its own per-instance state under the same instanceId, namespaced by
 * key (`promptsSelectedId`, `templatesSelectedId`, ...).
 */
export function LibraryPanel({ instanceId }: LibraryPanelProps) {
  const { t } = useTranslation()
  const [section, setSection] = useInstancePersistentState<Section>(
    instanceId,
    'librarySection',
    () => 'prompts',
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
              <TabsTrigger value="prompts" className="h-6 px-2 text-xs">
                {t('pages.library.navigation.prompts')}
              </TabsTrigger>
              <TabsTrigger value="skills" className="h-6 px-2 text-xs">
                {t('pages.library.navigation.skills')}
              </TabsTrigger>
              <TabsTrigger value="templates" className="h-6 px-2 text-xs">
                {t('pages.library.navigation.templates')}
              </TabsTrigger>
            </TabsList>
          </Tabs>,
          headerSlot,
        )}
      <div className="flex min-h-0 flex-1 flex-col">
        {section === 'prompts' && <PromptsSection instanceId={instanceId} />}
        {section === 'skills' && <SkillsSection instanceId={instanceId} />}
        {section === 'templates' && <TemplatesSection instanceId={instanceId} />}
      </div>
    </div>
  )
}
