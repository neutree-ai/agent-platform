---
name: nap-design-system
description: NAP web design system — semantic OKLCH tokens, the shadcn-based UI component library, and the visual conventions that keep generated UI on-brand. Trigger when building or editing NAP web UI (React + Tailwind + shadcn/ui), styling a new page/panel/dialog, picking colors or components, or reviewing a frontend diff for design-token compliance.
metadata:
  source: agent-platform/web + @neutree-ai/theme
---

# NAP Design System

NAP's web UI is **React + Vite + TailwindCSS (v3) + shadcn/ui**, themed by the
shared `@neutree-ai/theme` package. Every color is a **semantic OKLCH token**, not
a raw Tailwind palette color. Follow this skill to produce UI that matches the
existing app instead of generic AI-looking output.

## How to use this skill

- Read this file for the hard rules and the quick reference.
- Read `references/tokens.md` before choosing any color.
- Read `references/components.md` before hand-rolling a control — a shadcn
  component or variant almost certainly already exists.
- Read `references/patterns.md` for surfaces, glass panels, icons, dark mode,
  typography, and the recurring layout conventions.

## The hard rules (do not violate)

1. **Colors must be semantic tokens.** Use `bg-card`, `text-muted-foreground`,
   `border-border`, `bg-primary`, `text-warning`, etc. **Never** raw palette
   colors (`bg-slate-800`, `text-blue-500`, `#1e293b`) and **never** inline
   `style={{ color: ... }}`. Tokens carry light/dark automatically; raw colors
   break dark mode and the theme.
2. **Icons are `lucide-react`, never emoji.** Emoji must never stand in for an
   icon. Import the named icon component (`import { Plus } from "lucide-react"`).
3. **No unilateral component swaps.** Reuse `@/components/ui/*`; don't pull in a
   new UI library or reinvent a button/dialog/tooltip that already exists.
4. **Compose classes with `cn()`** from `@/lib/utils` (clsx + a customized
   tailwind-merge) so overrides merge correctly. Don't string-concatenate
   classes.
5. **Tune opacity, not hue.** Need a softer/stronger shade of a token? Use the
   alpha modifier: `bg-primary/90`, `bg-success/15`, `border-info/30`. Don't
   reach for a different palette color.
6. **Polish in place.** When you add a region, finish it to production quality
   (spacing, states, dark mode) rather than leaving a rough draft.

## Token quick reference

Semantic roles (each has a `-foreground` pair where text sits on it):

| Role | Use for |
| --- | --- |
| `background` / `foreground` | page surface + default text |
| `card` / `card-foreground` | raised panels, cards |
| `popover` / `popover-foreground` | menus, popovers, dropdowns |
| `primary` | primary actions, focused/active accent (a vivid blue-violet) |
| `secondary` | secondary buttons / low-emphasis fills |
| `muted` / `muted-foreground` | subtle fills + de-emphasized text |
| `accent` | hover backgrounds, gentle highlights |
| `border` / `input` / `ring` | borders, field borders, focus rings |
| `destructive` | delete/danger |
| `success` / `warning` / `info` | status semantics (green / amber / blue) |
| `chart-1..9` | categorical chart series (Tremor) |
| `tag-{slate,rose,amber,emerald,sky,violet,orange,pink}` | user-selectable tag colors |
| `sidebar-*` | the app sidebar surface |

Full values, the alpha pattern, and dark-mode behavior: `references/tokens.md`.

## Component quick reference

`@/components/ui/` (shadcn/ui + a few custom). Highlights — full inventory and
variant cheat-sheets in `references/components.md`:

- **Button** — variants `default | destructive | outline | secondary | ghost | link`; sizes `default | sm | lg | icon`.
- **Badge** — solid (`default | secondary | destructive | success | warning`) and soft tints (`success-soft | destructive-soft | accent-soft | info-soft | warning-soft | muted-soft`) for status chips.
- **Card** (`Card/CardHeader/CardTitle/CardDescription/CardContent/CardFooter`), **Dialog**, **DropdownMenu**, **Popover**, **Tooltip**, **Tabs**, **Select**, **Combobox**, **Input/Textarea/Label/Checkbox/Switch**, **Alert**, **Progress**, **ScrollArea**, **Separator**, **SegmentedControl**, **Spinner**, **Sonner** (toasts), plus app-specific ones (`copy-button`, `confirm-button`, `cron-editor`, `diff-view`, `key-value`, `markdown`, `empty-hero`).

## Stack facts

- Path alias `@/*` → `web/src/*`. `cn` lives at `@/lib/utils`.
- Tailwind config: `web/tailwind.config.js`. Tokens are wired as
  `oklch(var(--token) / <alpha-value>)`, so `/NN` opacity modifiers work on
  every semantic color.
- Theme variables: `@neutree-ai/theme/variables.css` (imported in
  `web/src/index.css`). Dark mode is **class-based** (`.dark` on the root).
- Variants are authored with `class-variance-authority` (cva).
- Custom font sizes: `text-micro` (9px), `text-mini` (10px), `text-tiny` (11px).
- Radius scales off `--radius` (`rounded-lg/md/sm`).
