# POST /api/skills/{id}/exports

**Resource:** [skills](../resources/skills.md)
**Mint a public share URL for a skill (owner only)**
**Operation ID:** `post--api-skills-{id}-exports`

Returns a capability URL installable with `npx skills add <url>`. Defaults to a 90-day lifetime; pass `ttl_days: null` for a permanent share. Shares cannot be extended — mint a replacement and revoke the old one. `slug` is derived from the skill name; when the name yields nothing usable (e.g. all-CJK) the call returns 400 and `slug` must be supplied.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ttl_days` | integer,null | No |  |
| `label` | string | No |  |
| `slug` | string | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Share created |
| 400 | Skill has no published version |
| 404 | Skill not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes |  |
| `url` | string | Yes |  |
| `slug` | string | Yes |  |
| `label` | string | Yes |  |
| `expires_at` | string,null | Yes |  |
| `last_used_at` | string,null | Yes |  |
| `created_at` | string | Yes |  |

## Security

- **bearerAuth**
