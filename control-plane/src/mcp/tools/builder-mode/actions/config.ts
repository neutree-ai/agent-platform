import {
  BUILDER_KIND_CONFIG_UPDATE,
  BUILDER_KIND_PROMPT_SET,
  ConfigUpdatePayloadSchema,
  PromptSetPayloadSchema,
} from '../../../../../../internal/types/builder'
import { getProviderForUser } from '../../../../services/db/model-providers'
import { getPromptForUser } from '../../../../services/db/prompts'
import { updateWorkspace } from '../../../../services/db/workspaces'
import { applyWorkspaceConfigUpdate } from '../../../../services/workspace-config'
import { defineBuilderAction } from '../define-action'

export const configUpdateAction = defineBuilderAction({
  kind: BUILDER_KIND_CONFIG_UPDATE,
  resource: 'config',
  payload: ConfigUpdatePayloadSchema,
  label: 'Update workspace base info',
  proposeDescription:
    "Update the current workspace's base info (name, slug, visibility, agent_type, provider, model). Only set the fields you want to change. System prompt is managed separately by `workspace_prompt_propose` — do not pass system_prompt or prompt_id here. See `__platform__:reference/builder-mode.md` for the contract.",
  apply: async ({ workspaceId, userId, payload }) => {
    if (payload.provider_id !== undefined && payload.provider_id !== '') {
      const provider = await getProviderForUser(payload.provider_id, userId)
      if (!provider) throw new Error(`provider not visible to user: ${payload.provider_id}`)
    }

    const workspacePatch: Record<string, unknown> = {}
    if (payload.name !== undefined) workspacePatch.name = payload.name
    if (payload.slug !== undefined) workspacePatch.slug = payload.slug || null
    if (payload.visibility !== undefined) workspacePatch.visibility = payload.visibility

    const configPatch: Parameters<typeof applyWorkspaceConfigUpdate>[1] = {}
    if (payload.agent_type !== undefined) configPatch.agent_type = payload.agent_type
    if (payload.provider_id !== undefined) configPatch.provider_id = payload.provider_id || null
    if (payload.model !== undefined) configPatch.model = payload.model
    if (payload.small_model !== undefined) configPatch.small_model = payload.small_model

    const changed: string[] = [...Object.keys(workspacePatch), ...Object.keys(configPatch)]
    if (changed.length === 0) return 'No change.'

    if (Object.keys(workspacePatch).length > 0) {
      await updateWorkspace(workspaceId, workspacePatch)
    }
    if (Object.keys(configPatch).length === 0) {
      return `Workspace config updated: ${changed.join(', ')}.`
    }

    const { rebuilt } = await applyWorkspaceConfigUpdate(workspaceId, configPatch)
    if (rebuilt) {
      return `Workspace config updated (${changed.join(', ')}); container rebuilding for agent_type change.`
    }
    return `Workspace config updated: ${changed.join(', ')}.`
  },
})

export const promptSetAction = defineBuilderAction({
  kind: BUILDER_KIND_PROMPT_SET,
  resource: 'prompt',
  payload: PromptSetPayloadSchema,
  label: 'Set workspace system prompt',
  proposeDescription:
    'Change the current workspace\'s system prompt source. Pass `prompt_id` (a library prompt id from `list_prompts`) for a library reference, or `system_prompt` for inline text — the two are mutually exclusive; setting one clears the other. Use `""` to clear either side. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, userId, payload }) => {
    if (payload.prompt_id !== undefined && payload.prompt_id !== '') {
      const prompt = await getPromptForUser(payload.prompt_id, userId)
      if (!prompt) throw new Error(`prompt not visible to user: ${payload.prompt_id}`)
    }

    const configPatch: Parameters<typeof applyWorkspaceConfigUpdate>[1] = {}
    if (payload.prompt_id !== undefined) {
      configPatch.prompt_id = payload.prompt_id || null
      if (payload.prompt_id !== '') configPatch.system_prompt = ''
    }
    if (payload.system_prompt !== undefined) {
      configPatch.system_prompt = payload.system_prompt
      if (payload.system_prompt !== '') configPatch.prompt_id = null
    }

    await applyWorkspaceConfigUpdate(workspaceId, configPatch)

    if (payload.prompt_id !== undefined && payload.prompt_id !== '') {
      return `Workspace system prompt switched to library prompt ${payload.prompt_id}.`
    }
    if (payload.system_prompt !== undefined && payload.system_prompt !== '') {
      return 'Workspace system prompt set to inline text.'
    }
    return 'Workspace system prompt cleared.'
  },
})
