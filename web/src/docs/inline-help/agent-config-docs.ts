import { i18n } from '@/lib/i18n'
import { loadDoc } from './_load'

export type AgentConfigSection = 'model' | 'prompt' | 'mcp' | 'settings' | 'skills' | 'resources'

function getSettingsDoc(agentType: string): string {
  switch (agentType) {
    case 'codex':
      return loadDoc('agent-config-settings-codex')
    // `goose-dev` is the canary alias of `goose` (dev-image rollout pattern).
    case 'goose':
    case 'goose-dev':
      return loadDoc('agent-config-settings-goose')
    default:
      return loadDoc('agent-config-settings-claude-code')
  }
}

function getSectionDoc(section: AgentConfigSection, agentType: string): string {
  switch (section) {
    case 'model':
      return loadDoc('agent-config-model')
    case 'prompt':
      return loadDoc('agent-config-prompt')
    case 'mcp':
      return loadDoc('agent-config-mcp')
    case 'skills':
      return loadDoc('agent-config-skills')
    case 'resources':
      return loadDoc('agent-config-resources')
    case 'settings':
      return getSettingsDoc(agentType)
  }
}

function templateInheritanceHeader(): string {
  return `${i18n.t('docs.inlineHelp.agentConfig.templateInheritanceHeader')}\n\n---\n\n`
}

export function getAgentConfigDoc(
  section: AgentConfigSection,
  opts: { hasTemplate: boolean; agentType: string },
): string {
  const doc = getSectionDoc(section, opts.agentType)
  return opts.hasTemplate && section === 'model' ? templateInheritanceHeader() + doc : doc
}

export function joinAgentConfigDocs(sections: AgentConfigSection[], agentType: string): string {
  return sections.map((s) => getSectionDoc(s, agentType)).join('\n\n---\n\n')
}
