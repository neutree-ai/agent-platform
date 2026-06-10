# Visual Patterns & Conventions

Recurring decisions that keep NAP UI coherent. These encode taste the existing
app already follows — match them.

## Icons — lucide, never emoji

Icons are always `lucide-react` component imports. **Emoji must never be used as
an icon** (not in buttons, headers, list markers, status indicators). Inside a
`Button` or other ui control, lucide SVGs auto-size to 16px.

```tsx
import { Plus, Trash2, Check } from "lucide-react"
<Button><Plus /> New</Button>
```

## Surfaces & elevation

- Page background: `bg-background`. Raised panels/cards: `bg-card` + `border` +
  `shadow-sm` (use the `Card` component).
- Menus/popovers/tooltips: `bg-popover text-popover-foreground`.
- Hover affordance on interactive rows/items: `hover:bg-accent
  hover:text-accent-foreground` (this is the `ghost`/menu-item idiom).
- De-emphasized text (captions, metadata, placeholders): `text-muted-foreground`.

### Desktop wallpaper

The workbench surface is `.desktop-wallpaper` + a preset modifier
(`--aurora | --minimal | --cool | --warm`), defined in `web/src/index.css`. All
washes are built from theme tokens (`--warning`, `--info`, `--accent`,
`--success`) at low alpha so presets adapt to light/dark automatically. Presets
differ only in which gradient layers and alphas they include — **never** in raw
oklch values. If you add a preset, follow the same token-only rule.

## Glass / floating panels

A floating "glass" panel's depth comes from a **colored gradient + blur
refraction**, not blur over a flat neutral. `backdrop-blur` on top of a plain
`foreground`/alpha fill reads as nothing. Layer a subtle token gradient
(e.g. `primary → info` at low alpha) under the blur so light bends through it.

## Dark mode

Class-based (`.dark` on a root ancestor). You get it for free **only** if every
color is a semantic token. After building anything, sanity-check it in dark mode;
the usual breakage is a hardcoded color that didn't flip.

## Typography

- Body text inherits the CJK-aware `font-sans` stack (CJK fallbacks inserted
  before `sans-serif` so Print-to-PDF keeps Chinese glyphs). Don't override the
  font family.
- Small UI text: `text-tiny` (11px), `text-mini` (10px), `text-micro` (9px) for
  dense metadata. Standard `text-sm` for most secondary text.
- Rendered markdown/prose uses the `@tailwindcss/typography` `prose` classes,
  tuned compact in `index.css` (tight headings/tables for chat bubbles). Use the
  `markdown` component rather than re-styling prose ad hoc.

## Layout idioms

- **App window headers align left.** Projected header content (title/actions of
  an app window) goes left; don't push it right with `ml-auto`. Reserve the right
  edge for hover-only window controls.
- Prefer `ScrollArea` over raw `overflow-y-auto` divs for scrollable regions.
- Errors: `Alert` with `variant="destructive"` rather than a hand-rolled red div.

## Runtime key → asset/variant mapping

When mapping a runtime key (status, kind, agent type) to a class/asset/variant,
use an explicit `switch` with literal names — not a template-string lookup like
`` `prefix-${key}` ``. Literal names keep grep and refactors working.

```ts
// ✓
switch (status) {
  case "healthy": return "success-soft"
  case "pending": return "warning-soft"
  case "failed":  return "destructive-soft"
}
// ✗  variant = `${status}-soft`   // invisible to grep, breaks on rename
```

## Quality bar

- Finish each region to production quality as you add it (states: hover, focus,
  disabled, empty, loading, dark) rather than leaving rough drafts to revisit.
- Extract a component when a visual unit repeats; don't copy-paste markup.
- Keep colors on tokens, icons on lucide, classes through `cn()`. Those three
  rules alone keep generated UI on-brand.
