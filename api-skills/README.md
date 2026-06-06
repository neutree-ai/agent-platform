# api-skills

NAP service REST APIs packaged as [Agent Skills](https://docs.claude.com/en/docs/agent-skills), generated from each service's live OpenAPI spec via [openapi-to-skills](https://github.com/neutree-ai/openapi-to-skills).

These are consumer-facing skills for driving NAP from outside the UI (local scripts, CI, other agent hosts). All requests authenticate with a **NAP Service Token** — see `<skill>/references/authentication.md`.

## Skills

| Skill | Spec source | Description |
|-------|-------------|-------------|
| `nap-api/` | control-plane `/api/docs/openapi.json` | NAP control plane — workspaces, prompts, templates, credentials, tokens, agent files, providers, tags, shares, schedules |

## Regenerate

Fetches the latest spec and rewrites the skill in place. Point `CP_SPEC_URL` at any running control-plane that serves the OpenAPI doc (local dev, a port-forward, etc.):

```bash
CP_SPEC_URL=http://localhost:3000/api/docs/openapi.json npm run cp
```

`fetch:cp` snapshots the spec to `specs/control-plane.json`; `generate:cp` runs `openapi-to-skills` against it. `CP_SPEC_URL` is required — there is no default host.

## Layout

```
api-skills/
├── specs/          # snapshotted OpenAPI specs (regenerable)
├── templates/      # Eta template overrides applied during generation
└── nap-api/        # generated skill (SKILL.md + references/)
```

## Customizations

- `templates/authentication.md.eta` — replaces the generic bearer-scheme blurb with steps to create a token in NAP Web (**Integration → Tokens**).
- `templates/skill.md.eta` — scenario-based `description` for recall, a concrete Base URL (`$NAP_BASE_URL` convention), a Conventions block (URL-encode path-bearing query params), a "Common Intents → Operation" map, and an inline end-to-end async chat + poll example.
- `templates/resource.md.eta` — per-resource orientation preambles (disambiguates the look-alike agent-files / agent-afs-files / afs / shares resources).

The skill-specific blocks above are keyed by skill name (`nap-api`); other skills fall back to generic rendering.

> Currently cp-only; other services can be added back as new `fetch:`/`generate:` script pairs.
