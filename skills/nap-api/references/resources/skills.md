# skills

Reusable agent Skills — import (git or upload), version, share by visibility / team grant, and attach to workspaces.

## Operations

| Method | Path | Summary | Details |
|--------|------|---------|----------|
| GET | `/api/skills` | List skills visible to the user (own + public + team-shared) | [View](../operations/get-api-skills.md) |
| POST | `/api/skills` | Upload a skill package (tar.gz). Metadata goes in query params. | [View](../operations/post-api-skills.md) |
| POST | `/api/skills/scan-git` | List skill candidates in a git repo without persisting | [View](../operations/post-api-skills-scan-git.md) |
| POST | `/api/skills/scan-tarball` | List skill candidates inside an uploaded tarball without persisting | [View](../operations/post-api-skills-scan-tarball.md) |
| POST | `/api/skills/from-git` | Import a single subpath from a git repo as a new skill | [View](../operations/post-api-skills-from-git.md) |
| POST | `/api/skills/sources/native` | Create a native (in-NAP authored) source + initial empty skill | [View](../operations/post-api-skills-sources-native.md) |
| GET | `/api/skills/sources` | List sources owned by the caller | [View](../operations/get-api-skills-sources.md) |
| GET | `/api/skills/sources/{id}` | Read one source by id | [View](../operations/get-api-skills-sources-id.md) |
| DELETE | `/api/skills/sources/{id}` | Delete a source (owner only); fails if any skill still under it | [View](../operations/delete-api-skills-sources-id.md) |
| PATCH | `/api/skills/sources/{id}` | Update source metadata (owner only) | [View](../operations/patch-api-skills-sources-id.md) |
| GET | `/api/skills/sources/{id}/skills` | List skills derived from this source | [View](../operations/get-api-skills-sources-id-skills.md) |
| POST | `/api/skills/sources/{id}/sync` | Re-fetch a git source; create new versions for changed skills | [View](../operations/post-api-skills-sources-id-sync.md) |
| PUT | `/api/skills/sources/{id}/draft` | Save the native source draft (tar.gz body) | [View](../operations/put-api-skills-sources-id-draft.md) |
| DELETE | `/api/skills/sources/{id}/draft` | Discard the native source draft | [View](../operations/delete-api-skills-sources-id-draft.md) |
| GET | `/api/skills/sources/{id}/draft/files` | List the source draft scratch tree | [View](../operations/get-api-skills-sources-id-draft-files.md) |
| GET | `/api/skills/sources/{id}/draft/file` | Read a single draft file | [View](../operations/get-api-skills-sources-id-draft-file.md) |
| PUT | `/api/skills/sources/{id}/draft/file` | Write a single draft file | [View](../operations/put-api-skills-sources-id-draft-file.md) |
| DELETE | `/api/skills/sources/{id}/draft/file` | Delete a single draft file | [View](../operations/delete-api-skills-sources-id-draft-file.md) |
| GET | `/api/skills/{id}` | Read one skill by id (visibility-gated) | [View](../operations/get-api-skills-id.md) |
| DELETE | `/api/skills/{id}` | Delete a skill (owner only). Fails if still attached anywhere. | [View](../operations/delete-api-skills-id.md) |
| PATCH | `/api/skills/{id}` | Update skill metadata. Owner: anything. Editor: description only. | [View](../operations/patch-api-skills-id.md) |
| GET | `/api/skills/{id}/dependents` | Workspaces / template versions using this skill (owner only) | [View](../operations/get-api-skills-id-dependents.md) |
| GET | `/api/skills/{id}/package` | Download the skill's active-version tar.gz package | [View](../operations/get-api-skills-id-package.md) |
| GET | `/api/skills/{id}/files` | Read a file from the skill package (visibility-gated) | [View](../operations/get-api-skills-id-files.md) |
| GET | `/api/skills/{id}/dirs` | List directory entries inside a skill package (visibility-gated) | [View](../operations/get-api-skills-id-dirs.md) |
| GET | `/api/skills/{id}/dirs/zip` | Download a directory inside a skill package as a zip archive | [View](../operations/get-api-skills-id-dirs-zip.md) |
| GET | `/api/skills/{id}/versions` | List published versions for a skill (newest first) | [View](../operations/get-api-skills-id-versions.md) |
| GET | `/api/skills/{id}/versions/{vid}/package` | Download one historical version package | [View](../operations/get-api-skills-id-versions-vid-package.md) |
| POST | `/api/skills/{id}/publish` | Publish the native draft as a new active version | [View](../operations/post-api-skills-id-publish.md) |
| PUT | `/api/skills/{id}/active-version` | Switch the active version pointer (owner only) | [View](../operations/put-api-skills-id-active-version.md) |
| GET | `/api/skills/{id}/grants` | List team grants for a skill (owner only) | [View](../operations/get-api-skills-id-grants.md) |
| PUT | `/api/skills/{id}/grants` | Replace team grants for a skill (owner only) | [View](../operations/put-api-skills-id-grants.md) |
