import type { ApiPrompt, ApiPromptVersion } from '../../../../internal/types/api'
import type { PromptWithAccess } from '../../services/db/prompts'
import type { PromptVersion } from '../../services/db/types'

export { reloadWorkspacesUsingPrompt } from '../../services/prompts'

export function toApi(p: PromptWithAccess): ApiPrompt {
  return {
    id: p.id,
    name: p.name,
    content: p.content,
    visibility: p.visibility,
    is_public: p.is_public,
    current_version: p.current_version,
    owner_name: p.owner_name,
    is_own: p.is_owner,
    my_permission: p.my_permission,
    shared_via_teams: p.shared_via_teams,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

export function toVersionApi(v: PromptVersion): ApiPromptVersion {
  return {
    version: v.version,
    content: v.content,
    created_at: v.created_at,
  }
}
