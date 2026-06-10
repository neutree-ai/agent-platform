# Color Tokens

Source of truth: `@neutree-ai/theme/src/variables.css`, wired into Tailwind in
`web/tailwind.config.js`. **Always style with these semantic tokens; never raw
Tailwind palette colors or hex.**

## How tokens reach Tailwind

Each token is a bare OKLCH triple (`L C H`, no `oklch()` wrapper) on `:root` and
`.dark`:

```css
:root      { --primary: 0.567 0.237 267.896; ... }
.dark      { --background: 0.134 0.016 272.261; ... }
```

Tailwind maps them as `oklch(var(--token) / <alpha-value>)`, so:

- `bg-primary`, `text-foreground`, `border-border` — solid token.
- `bg-primary/90`, `bg-success/15`, `text-info/70` — **opacity modifier works on
  every semantic color.** This is how you get softer/stronger shades — never by
  switching to a different palette color.

Dark mode is **class-based**: `.dark` on a root element flips every token. Because
you only ever reference the semantic name, your UI adapts for free. If you hardcode
`bg-slate-800` or `#1e293b`, dark mode breaks.

## Semantic roles

Every surface/intent role has a `-foreground` companion — the readable text/icon
color to use **on** that surface. Pair them: `bg-card text-card-foreground`,
`bg-destructive text-destructive-foreground`.

| Token | `-foreground`? | Role |
| --- | --- | --- |
| `background` | `foreground` | Default page surface + body text |
| `card` | `card-foreground` | Raised panels, cards, list rows |
| `popover` | `popover-foreground` | Menus, dropdowns, popovers, tooltips |
| `primary` | `primary-foreground` | Primary action, active/selected accent. A vivid blue-violet (`L 0.567 C 0.237 H 268`). Same in light & dark. |
| `secondary` | `secondary-foreground` | Secondary buttons, low-emphasis fills |
| `muted` | `muted-foreground` | Subtle backgrounds; `muted-foreground` is the standard de-emphasized/caption text color |
| `accent` | `accent-foreground` | Hover backgrounds, gentle highlight fills |
| `border` | — | Default border |
| `input` | — | Form-control border |
| `ring` | — | Focus ring (matches `primary`) |
| `destructive` | `destructive-foreground` | Delete / danger / irreversible |
| `success` | `success-foreground` | Success / healthy (green) |
| `warning` | `warning-foreground` | Caution / pending (amber) |
| `info` | `info-foreground` | Informational / neutral-positive (blue) |
| `sidebar-*` | several | The app sidebar's own surface, accent, border, ring |

### Status: solid vs. soft

`success` / `warning` / `info` / `destructive` are saturated — good for solid
badges and emphatic chips. For status text or quiet chips on card chrome, prefer
**soft tints** built with alpha (see the Badge `*-soft` variants in
`references/components.md`):

```
bg-success/15 text-success border-success/30      /* healthy chip */
bg-warning/15 text-warning border-warning/30      /* pending chip */
bg-destructive/10 text-destructive border-destructive/20
```

## Charts — `chart-1` … `chart-9`

Categorical series colors, Tableau-ordered (blue, amber, emerald, red, violet,
cyan, fuchsia, lime, teal). Dark mode raises lightness for contrast. Use with
Tremor (`@tremor/react`). Note Tremor builds color classes at runtime, so the
hues it uses (`blue`, `cyan`, `emerald`, `amber`, `violet`, `rose`, `slate`,
`fuchsia`, `lime`, `teal`) are **safelisted** in `tailwind.config.js` — keep new
chart colors within that safelist or extend it.

## Tags — `tag-{slate,rose,amber,emerald,sky,violet,orange,pink}`

Eight distinct hues for user-selectable tag/label colors. Light & dark variants
tuned for contrast. Reference as `bg-tag-violet`, `text-tag-sky`, etc.

## Radius & sizing tokens

- `--radius: 0.5rem` → `rounded-lg` = radius, `rounded-md` = radius−2px,
  `rounded-sm` = radius−4px. Use these, not arbitrary `rounded-[6px]`.
- Custom font sizes (in addition to Tailwind's): `text-micro` (9px/12),
  `text-mini` (10px/14), `text-tiny` (11px/15). `tailwind-merge` is extended in
  `cn()` so these are treated as font-size (won't collide with `text-*` colors).

## Anti-patterns

```diff
- <div className="bg-slate-900 text-gray-400 border-gray-700">
+ <div className="bg-card text-muted-foreground border-border">

- <span style={{ color: "#16a34a" }}>Healthy</span>
+ <span className="text-success">Healthy</span>

- className="bg-blue-500/80"   // wanted a softer primary
+ className="bg-primary/80"
```
