import {
  BUILDER_KIND_PROMPT_LIBRARY_CREATE,
  BUILDER_KIND_PROMPT_LIBRARY_DELETE,
  BUILDER_KIND_PROMPT_LIBRARY_UPDATE,
  PromptLibraryCreatePayloadSchema,
  PromptLibraryDeletePayloadSchema,
  PromptLibraryUpdatePayloadSchema,
} from '../../../../../../internal/types/builder'
import {
  createPrompt,
  deletePrompt,
  getPrompt,
  updatePrompt,
} from '../../../../services/db/prompts'
import { getWorkspace, listWorkspacesUsingPrompt } from '../../../../services/db/workspaces'
import { reloadWorkspacesUsingPrompt } from '../../../../services/prompts'
import { defineBuilderAction } from '../define-action'

export const promptLibraryCreateAction = defineBuilderAction({
  kind: BUILDER_KIND_PROMPT_LIBRARY_CREATE,
  scope: 'global',
  resource: 'prompt_create',
  payload: PromptLibraryCreatePayloadSchema,
  label: 'Create prompt',
  proposeDescription:
    "Create a new prompt in the current user's library. Defaults to private; pass `visibility: 'public'` only when the user has explicitly asked for an account-wide share. See `__platform__:reference/builder-mode.md` for the contract.",
  apply: async ({ workspaceId, payload }) => {
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) throw new Error('workspace not found')
    const prompt = await createPrompt(
      workspace.user_id,
      payload.name,
      payload.content,
      payload.visibility ?? 'private',
    )
    return `Prompt "${prompt.name}" created (id=${prompt.id}, visibility=${prompt.visibility}).`
  },
})

export const promptLibraryUpdateAction = defineBuilderAction({
  kind: BUILDER_KIND_PROMPT_LIBRARY_UPDATE,
  scope: 'global',
  resource: 'prompt_update',
  payload: PromptLibraryUpdatePayloadSchema,
  label: 'Update prompt',
  proposeDescription:
    'Update an existing prompt in the user library. Owner-only — team-shared / public prompts visible via `list_prompts` are read-only here. See `__platform__:reference/builder-mode.md` for the contract and the versioning rule.',
  apply: async ({ workspaceId, payload }) => {
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) throw new Error('workspace not found')
    const existing = await getPrompt(payload.id)
    if (!existing) throw new Error('prompt not found')
    if (existing.user_id !== workspace.user_id) {
      throw new Error('prompt is not owned by the current user')
    }
    const updated = await updatePrompt(payload.id, {
      name: payload.name,
      content: payload.content,
      visibility: payload.visibility,
    })
    if (!updated) throw new Error('prompt disappeared during update')
    await reloadWorkspacesUsingPrompt(payload.id)
    const contentChanged = payload.content !== undefined && payload.content !== existing.content
    if (contentChanged) {
      return `Prompt "${updated.name}" updated (now v${updated.current_version}).`
    }
    return `Prompt "${updated.name}" updated.`
  },
})

export const promptLibraryDeleteAction = defineBuilderAction({
  kind: BUILDER_KIND_PROMPT_LIBRARY_DELETE,
  scope: 'global',
  resource: 'prompt_delete',
  payload: PromptLibraryDeletePayloadSchema,
  label: 'Delete prompt',
  proposeDescription:
    'Delete a prompt from the user library. Apply hard-fails if any workspace still references this prompt — the user must redirect those workspaces first. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const workspace = await getWorkspace(workspaceId)
    if (!workspace) throw new Error('workspace not found')
    const existing = await getPrompt(payload.id)
    if (!existing) throw new Error('prompt not found')
    if (existing.user_id !== workspace.user_id) {
      throw new Error('prompt is not owned by the current user')
    }
    const usingWorkspaces = await listWorkspacesUsingPrompt(payload.id, false)
    if (usingWorkspaces.length > 0) {
      const names = usingWorkspaces.map((w) => `"${w.name}" (${w.id})`).join(', ')
      throw new Error(
        `prompt is still referenced by ${usingWorkspaces.length} workspace(s): ${names}`,
      )
    }
    await deletePrompt(payload.id)
    return `Prompt "${existing.name}" deleted (id=${existing.id}).`
  },
})
