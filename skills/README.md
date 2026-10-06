# skills

NAP [Agent Skills](https://docs.claude.com/en/docs/agent-skills) shipped with the
platform. Two kinds live here:

- **Generated** from a service's OpenAPI spec via
  [openapi-to-skills](https://github.com/neutree-ai/openapi-to-skills) — e.g.
  `nap-api/`. Regenerable; don't hand-edit (see [Regenerate](#regenerate)).
- **Hand-authored** — curated guidance that isn't derived from a spec, e.g.
  `nap-design-system/`. Edit the `SKILL.md` / `references/` files directly.

API skills are consumer-facing for driving NAP from outside the UI (local
scripts, CI, other agent hosts) and authenticate with a **NAP Service Token** —
see `<skill>/references/authentication.md`.

## Skills

| Skill | Kind | Source | Description |
|-------|------|--------|-------------|
| `nap-api/` | generated | control-plane route definitions | NAP control plane — workspaces, prompts, templates, credentials, tokens, agent files, providers, tags, shares, schedules |
| `nap-design-system/` | hand-authored | `web` + `@neutree-ai/theme` | NAP web design system — semantic OKLCH tokens, the shadcn-based UI component library, and the conventions that keep generated UI on-brand |

## Regenerate

Applies only to **generated** skills. Exports the spec from the control-plane
source and rewrites the skill in place — no running server or database needed,
only `npm ci` in `control-plane/`:

```bash
npm run cp
```

`spec:cp` writes the OpenAPI document to `specs/control-plane.json` straight from the route definitions (`control-plane/scripts/export-openapi.ts`); `generate:cp` runs `openapi-to-skills` against it.

CI runs the same command and fails when the result differs from what is committed, so a control-plane API change must be committed together with its regenerated skill.

## Layout

```
skills/
├── specs/               # OpenAPI specs exported from source (regenerable)
├── templates/           # Eta template overrides applied during generation
├── assets/              # hand-authored static files overlaid onto generated skills
│   └── nap-api/         # → copied into nap-api/ after generation (e.g. scripts/handoff.sh)
├── nap-api/             # generated skill (SKILL.md + references/ + overlaid assets)
└── nap-design-system/   # hand-authored skill (SKILL.md + references/)
```

## Customizations (generated skills)

- `templates/authentication.md.eta` — replaces the generic bearer-scheme blurb with steps to create a token in NAP Web (**Integration → Tokens**).
- `templates/skill.md.eta` — scenario-based `description` for recall, a concrete Base URL (`$NAP_BASE_URL` convention), a Conventions block (URL-encode path-bearing query params), a "Common Intents → Operation" map, an end-to-end async chat + poll example, and a Handoff section pointing at the shipped `scripts/handoff.sh` driver.
- `templates/resource.md.eta` — per-resource orientation preambles (disambiguates the look-alike agent-files / agent-afs-files / afs / shares resources).
- `assets/nap-api/` — static files (e.g. `scripts/handoff.sh`) overlaid into the skill **after** generation via `openapi-to-skills --assets`. Regeneration wipes the skill dir, so hand-authored files that ship with the skill must live here, not in `nap-api/` directly. An asset overrides a generated file of the same path.

The skill-specific blocks above are keyed by skill name (`nap-api`); other skills fall back to generic rendering.

> Generated skills are currently cp-only; other services can be added back as new `spec:`/`generate:` script pairs.
