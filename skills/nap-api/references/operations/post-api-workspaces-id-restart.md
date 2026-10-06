# POST /api/workspaces/{id}/restart

**Resource:** [workspaces](../resources/workspaces.md)
**Restart a workspace — replace its pod, preserving state**
**Operation ID:** `post--api-workspaces-{id}-restart`

Recreates the workspace's pod (clearing in-pod ephemeral/agent state such as a stuck agent process) while keeping desired_phase=running, the PVC, and persisted session history. Replaces the racy client-side stop+start: bumps the placement spec so the env-runner rebuilds the Deployment in one converge, so the pod is always actually replaced (a fast stop+start could leave the old pod running because the stopped window was never observed).

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Restart initiated |
| 404 | Workspace not found |
| 500 | Internal error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
