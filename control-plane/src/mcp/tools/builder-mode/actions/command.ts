import {
  BUILDER_KIND_COMMAND_CREATE,
  BUILDER_KIND_COMMAND_DELETE,
  BUILDER_KIND_COMMAND_SET_DISABLED,
  BUILDER_KIND_COMMAND_UPDATE,
  CommandCreatePayloadSchema,
  CommandDeletePayloadSchema,
  CommandSetDisabledPayloadSchema,
  CommandUpdatePayloadSchema,
} from '../../../../../../internal/types/builder'
import {
  createWorkspaceCommand,
  deleteWorkspaceCommand,
  getWorkspaceCommand,
  listWorkspaceCommands,
  setTemplateCommandDisabled,
  updateWorkspaceCommand,
} from '../../../../services/db/commands'
import { defineBuilderAction } from '../define-action'

/**
 * Resolve a workspace's own (local) command by id, or throw a clear error.
 * Template-provided commands are read-only: they surface in `list_commands`
 * with a template_version_command id (not a workspace_commands row), so update
 * and delete must refuse them and point at disable/fork instead.
 */
async function requireLocalCommand(workspaceId: string, id: string) {
  const existing = await getWorkspaceCommand(id)
  if (existing && existing.workspace_id === workspaceId) return existing
  const tpl = (await listWorkspaceCommands(workspaceId)).find(
    (c) => c.id === id && c.source === 'template',
  )
  if (tpl) {
    throw new Error(
      `"/${tpl.name}" is a template-provided command and is read-only. Disable it (command_set_disabled) or fork it into a local command instead of editing/deleting it.`,
    )
  }
  throw new Error('command not found in this workspace')
}

export const commandCreateAction = defineBuilderAction({
  kind: BUILDER_KIND_COMMAND_CREATE,
  resource: 'command',
  payload: CommandCreatePayloadSchema,
  label: 'Create slash command',
  proposeDescription:
    'Create a slash command on the current workspace. See `__platform__:reference/builder-mode.md` for the propose/approve/apply contract.',
  apply: async ({ workspaceId, userId, payload }) => {
    const cmd = await createWorkspaceCommand({
      workspace_id: workspaceId,
      user_id: userId,
      name: payload.name,
      type: payload.type,
      prompt_id: payload.prompt_id ?? null,
      content: payload.prompt_id ? '' : (payload.prompt ?? ''),
    })
    return `Slash command "/${cmd.name}" created (id=${cmd.id}).`
  },
})

export const commandUpdateAction = defineBuilderAction({
  kind: BUILDER_KIND_COMMAND_UPDATE,
  resource: 'command_update',
  payload: CommandUpdatePayloadSchema,
  label: 'Update slash command',
  proposeDescription:
    'Update a slash command. Only set the fields you want to change. Template-provided commands are read-only — fork them first. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const existing = await requireLocalCommand(workspaceId, payload.id)
    const patch: Record<string, unknown> = {}
    if (payload.name !== undefined) patch.name = payload.name
    if (payload.type !== undefined) patch.type = payload.type
    if (payload.prompt !== undefined) {
      patch.content = payload.prompt
      patch.prompt_id = null
    } else if (payload.prompt_id !== undefined) {
      patch.prompt_id = payload.prompt_id || null
      patch.content = ''
    }
    const updated = await updateWorkspaceCommand(existing.id, patch)
    if (!updated) throw new Error('command disappeared during update')
    return `Slash command "/${updated.name}" updated (id=${updated.id}).`
  },
})

export const commandDeleteAction = defineBuilderAction({
  kind: BUILDER_KIND_COMMAND_DELETE,
  resource: 'command_delete',
  payload: CommandDeletePayloadSchema,
  label: 'Delete slash command',
  proposeDescription:
    'Delete a slash command. Template-provided commands cannot be deleted — disable them instead. See `__platform__:reference/builder-mode.md` for the contract.',
  apply: async ({ workspaceId, payload }) => {
    const existing = await requireLocalCommand(workspaceId, payload.id)
    await deleteWorkspaceCommand(existing.id)
    return `Slash command "/${existing.name}" deleted (id=${existing.id}).`
  },
})

export const commandSetDisabledAction = defineBuilderAction({
  kind: BUILDER_KIND_COMMAND_SET_DISABLED,
  resource: 'command_set_disabled',
  payload: CommandSetDisabledPayloadSchema,
  label: 'Enable/disable command',
  proposeDescription:
    'Enable or disable a slash command for this workspace (by name). Works for both local commands and template-provided ones — toggling a command off removes it from the slash menu without deleting it. See `__platform__:reference/builder-mode.md`.',
  apply: async ({ workspaceId, userId, payload }) => {
    // Resolve by name: a local command (which shadows any same-named template
    // command) flips its own row; a template command toggles a marker.
    const target = (await listWorkspaceCommands(workspaceId)).find((c) => c.name === payload.name)
    if (!target) {
      throw new Error(`command "/${payload.name}" not found in this workspace`)
    }
    if (target.source === 'local') {
      await updateWorkspaceCommand(target.id, { disabled: payload.disabled })
    } else {
      await setTemplateCommandDisabled(workspaceId, userId, payload.name, payload.disabled)
    }
    return `Command "/${payload.name}" ${payload.disabled ? 'disabled' : 'enabled'}.`
  },
})
