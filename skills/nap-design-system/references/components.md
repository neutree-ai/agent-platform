# Component Library

Reusable UI lives in `web/src/components/ui/` — shadcn/ui primitives (Radix +
cva) plus a few app-specific components. **Reuse these before hand-rolling
anything.** Import via the `@/` alias, compose extra classes with `cn()`.

```tsx
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
```

## `cn()` — the class merge helper

`@/lib/utils` exports `cn(...inputs)` = `clsx` + a **customized** `tailwind-merge`
(it registers `text-micro/mini/tiny` as font-size). Always merge classes through
it so caller overrides win and conflicting utilities dedupe:

```tsx
<div className={cn("rounded-lg border bg-card p-4", className)} />
```

## Variants are cva

Components expose variants via `class-variance-authority`. Pass `variant` /
`size` props; add one-off tweaks through `className` (merged by `cn`). Don't fork
a component to restyle it — use an existing variant or extend the cva map.

### Button — `@/components/ui/button`

```tsx
<Button>Save</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="destructive">Delete</Button>
<Button variant="ghost" size="icon"><Trash2 /></Button>   // icon-only
```

- **variant**: `default` (primary fill) · `destructive` · `outline` · `secondary` · `ghost` · `link`
- **size**: `default` (h-10) · `sm` (h-9) · `lg` (h-11) · `icon` (square)
- `asChild` renders the styling onto a child (e.g. a router `<Link>`).
- SVG icons inside auto-size to 16px (`[&_svg]:size-4`) — drop a lucide icon in directly.

### Badge — `@/components/ui/badge`

Solid: `default` · `secondary` · `destructive` · `success` · `warning` · `outline`.
Soft tints for status chips that read distinct but quiet on card chrome:
`success-soft` · `destructive-soft` · `accent-soft` · `info-soft` · `warning-soft` · `muted-soft`.

```tsx
<Badge variant="success-soft">Active</Badge>
<Badge variant="warning-soft">Pending</Badge>
```

### Card — `@/components/ui/card`

`Card` (`rounded-lg border bg-card text-card-foreground shadow-sm`) +
`CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`.
Use the parts rather than re-deriving padding — header/content are `p-6`,
content/footer drop the top padding (`pt-0`).

## Inventory

**Primitives / form**: `button`, `input`, `textarea`, `label`, `checkbox`,
`switch`, `select`, `combobox`, `segmented-control`, `timezone-select`,
`workspace-multi-select`, `cron-editor`.

**Surfaces / overlays**: `card`, `dialog`, `documented-dialog`, `popover`,
`dropdown-menu`, `tooltip`, `command` (⌘K palette), `scroll-area`, `separator`,
`tabs`, `collapsible`, `sub-page-layout`.

**Feedback / status**: `alert`, `badge`, `progress`, `spinner`, `breathing-halo`,
`sonner` (toasts — call via the `sonner` API), `empty-hero`,
`empty-illustration`.

**Action helpers**: `confirm-button`, `confirm-menu-item` (inline confirm flows),
`save-button`, `copy-button`, `platform-cmd`.

**Content**: `markdown` (rendered markdown), `diff-view`, `key-value`, `card`.

## When something isn't here

1. Check shadcn/ui — if it's a standard shadcn component, add it the shadcn way
   (`components.json` is configured: style=default, baseColor=slate,
   cssVariables=true) so it inherits tokens.
2. Build it from primitives + tokens, matching the cva/`cn()` conventions above.
3. If it's a reusable visual unit appearing more than once, extract a component
   rather than copy-pasting markup.

Don't introduce a second component library or a CSS-in-JS solution.
