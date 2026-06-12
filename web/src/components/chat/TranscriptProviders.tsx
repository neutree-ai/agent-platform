// Wires the @neutree-ai/ui-sdk transcript providers for this app: the SDK's own
// i18n (so the chat strings live solely in the SDK bundle — the app no longer
// duplicates components.chat.*), the app's rich markdown renderer, the agent
// type, and the lazy tool-renderer bridge (so on-demand plugin renderers still
// load on chat render). Used by both the workspace chat and the public share
// view.
import { Markdown } from '@/components/ui/markdown'
import {
  getLazyRegistryVersion,
  getLazyToolRenderer,
  subscribeLazyRegistry,
} from '@/lib/plugin-lazy-registry'
import { ensurePluginLoaded } from '@/lib/plugin-loader'
import {
  AgentTypeProvider,
  type LazyToolRenderers,
  LazyToolRenderersProvider,
  MarkdownProvider,
  TranscriptI18nProvider,
} from '@neutree-ai/ui-sdk'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const lazyToolRenderers: LazyToolRenderers = {
  getPluginId: getLazyToolRenderer,
  load: ensurePluginLoaded,
  subscribe: subscribeLazyRegistry,
  getVersion: getLazyRegistryVersion,
}

export function TranscriptProviders({
  agentType,
  children,
}: {
  agentType: string
  children: ReactNode
}) {
  const { i18n } = useTranslation()
  return (
    <TranscriptI18nProvider locale={i18n.language}>
      <LazyToolRenderersProvider value={lazyToolRenderers}>
        <AgentTypeProvider value={agentType}>
          <MarkdownProvider value={Markdown}>{children}</MarkdownProvider>
        </AgentTypeProvider>
      </LazyToolRenderersProvider>
    </TranscriptI18nProvider>
  )
}
