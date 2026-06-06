import { PreferencesDialog } from '@/components/PreferencesDialog'
import { registerDialog } from '@/contexts/DialogStackContext'
import CreateConnectorDialog from './CreateConnectorDialog'
import CreateCredentialDialog from './CreateCredentialDialog'
import CreateProviderDialog from './CreateProviderDialog'
import CreateSkillDialog from './CreateSkillDialog'
import CreateTemplateDialog from './CreateTemplateDialog'
import CreateTokenDialog from './CreateTokenDialog'
import CreateWorkspaceDialog from './CreateWorkspaceDialog'

/**
 * Central dialog registration. Imported once at app boot so every key
 * referenced by `useDialogStack().open(...)` (sections, command palette,
 * markdown links, ...) resolves to a real component without each caller
 * having to mount the dialog themselves.
 *
 * Add new entries here as dialogs are extracted into shareable components.
 */
registerDialog('create-provider', CreateProviderDialog)
registerDialog('create-credential', CreateCredentialDialog)
registerDialog('create-token', CreateTokenDialog)
registerDialog('create-connector', CreateConnectorDialog)
registerDialog('create-skill', CreateSkillDialog)
registerDialog('create-template', CreateTemplateDialog)
registerDialog('create-workspace', CreateWorkspaceDialog)
registerDialog('preferences', PreferencesDialog)
