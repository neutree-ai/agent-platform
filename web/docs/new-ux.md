# New UX — Shell, Apps, and State Architecture

Living document for the redesigned web shell. Captures the model and the
rules so future work doesn't have to re-derive them.

## Concepts

- **Layout** — viewport-level frame with named slots (1-col / 2-col / 3-col).
  `web/src/components/shell/layout/`. Each layout exports `SlotConfig[]` —
  slot ids and `defaultOpened: string[]` (app ids preloaded on first visit).
- **Slot** — a named region in the active layout (`slot-a`, `slot-b`, …).
  Holds a list of opened **app instances**, plus an active id.
- **App** — a self-contained UI unit. Defined by `AppDefinition` in
  `web/src/lib/app-registry.ts`. Component receives an `instanceId` prop;
  multi-instance is the default and `open()` always creates a fresh instance.
- **AppInstance** — one opened cell in a slot: `{ id, appId }`. Two instances
  of the same app coexist independently (two Files panes browsing different
  paths, two Terminals).
- **`SlotContext`** (`web/src/contexts/SlotContext.tsx`) — owns slot/instance
  state for the current workspace. Reads/writes go through the workspace
  profile store (DB-backed). API: `getState`, `open`, `activate`, `close`,
  `ensureInstance(appId)`, `filledSlot` for full-canvas focus.

## Persistence layers

| Layer | Lifetime | API | Use for |
| --- | --- | --- | --- |
| Workspace profile (DB jsonb) | refresh / cross-device | zustand store + debounced PATCH | layout id, slots `{opened, active}` (incl. `popout`), popout window geometry, per-instance persistent prefs |
| Instance memory store | unmount-survive in tab; lost on refresh | `useInstanceState` | mid-action input, fetched data caches when not using react-query, derived |
| Component-local | render cycle | `useState` | dialog open, drag counter, timer, request busy |
| URL search params | per-tab navigation | `useSearchParams` | only `?session=` (user-shareable). NOT for layout / slot active / view config. |

### `workspace_profile` payload (client-managed jsonb)

```ts
{
  layout_id?: '1col' | '2col' | '3col',
  slots?: Record<string, { opened?: AppInstance[], active?: string | null }>,
  // The slots map also carries the virtual `popout` slot (tab list of
  // popped-out instances).
  popoutGeo?: { x: number; y: number; w: number; h: number },
  instances?: Record<string, Record<string, unknown>>,  // per-instance persistent state
}
```

Backend table: `control-plane/migrations/074_workspace_profile.sql`.
PATCH does shallow merge (`payload || $1::jsonb`) so concurrent tabs and
older clients don't clobber unknown keys. To delete a key (e.g., remove a
closed instance from `instances`), the client must read, mutate, and write
back the full nested object — the merge can't delete keys.

### Hooks

```ts
// In-memory, dies on refresh. Use for mid-action and re-fetchable state.
const [v, setV] = useInstanceState(instanceId, key, () => default)

// Persisted to workspace_profile.instances[instanceId][key].
// Survives refresh / cross-device. Use for view config + "where am I".
const [v, setV] = useInstancePersistentState(instanceId, key, () => default)

// Imperative writes from outside React (markdown link click handler etc.)
setInstanceState(instanceId, key, value)
setPersistentInstanceState(workspaceId, instanceId, key, value)
```

When `SlotContext.close` removes an instance, both layers are dropped
automatically.

## Decision rule for "where does this state live?"

> **配置 + 位置 → persistent**
> **中态 + 数据 → memory**
> **DOM 瞬态 → useState**

Quick test: *if user refreshes, do they expect this to come back?*

- yes → `useInstancePersistentState` (cwd, drive, sort, active nav, expanded
  row, viewing path)
- no, but they shouldn't lose it across layout switch → `useInstanceState`
  (search query, fetched listing, mid-edit draft they're actively typing)
- no, single-interaction transient → `useState` (dialog open, armed-confirm
  timer, drag counter, xhr progress)

Server data: prefer **react-query** (`useQuery` keyed by relevant inputs);
the cache key replaces what would otherwise be a `useInstanceState` slot.
For one-off writes use `useMutation` with `qc.invalidateQueries` in
`onSuccess`.

## Pop-out layer

A floating window above the layout. Modeled as a virtual slot named
`popout` so it reuses every slot mechanic (open/activate/close, instance
state cleanup, layout-default seeding) — it just isn't rendered by any
layout. Tab consolidation falls out: `popout.opened` is a normal
instance list with `activeId`, drawn as a tab strip in the floating
window.

Two ways an instance lands in the popout layer:

```ts
// Move a slotted instance to the popout (slot's pop-out button).
slotCtx.popOut(slotId, instanceId)

// Spawn a fresh instance directly into the popout, with optional
// persistent-state seed. Files / markdown ExternalLink target the hidden
// `file` app so the floating window holds a clean FileViewer rather than
// the full Files browser.
slotCtx.openInPopout('file', { viewingPath: '/foo.md' })
```

Reverse: `slotCtx.popIn(instanceId)` moves a popped-out instance back
into the layout slot whose `defaultOpened` lists its appId (falling
back to slot-a). Instance keeps its id throughout — per-instance state
(memory + persistent) is unaffected by the move.

Geometry of the floating window is persisted in
`workspace_profile.popoutGeo` and committed on pointer-up only (during
drag/resize the DOM is mutated directly). Position survives refresh.

`PopoutLayer` (`web/src/components/shell/PopoutLayer.tsx`) is mounted
inside `<SlotProvider>` in Desktop. It renders nothing when the popout
slot is empty.

## Cross-instance routing

External callers (markdown links, command palette items, "open file in
files panel" actions) should **not** push URL params. Instead:

```ts
const { slotId, instanceId } = slotCtx.ensureInstance('files')
setPersistentInstanceState(workspaceId, instanceId, 'viewingPath', path)
slotCtx.activate(slotId, instanceId)
```

`ensureInstance` finds the first existing instance of `appId`, or creates
one in the slot whose layout default lists it (falls back to slot-a).

## App contract

```ts
interface AppDefinition {
  id: string
  label: string
  Component: ComponentType<{ instanceId: string }>
  disabled?: boolean
  /** Hidden apps don't show in dock/SlotPicker — only programmatic creation. */
  hidden?: boolean
  /** Per-instance tab label, derived from persistent state. */
  instanceLabel?: (persistent: Record<string, unknown>) => string | null
}
```

### Hidden apps

Apps marked `hidden: true` are real apps in every other respect (they have
a Component, an id, get an instanceId, participate in slot/instance state)
— they just don't appear in the dock or SlotPicker. They exist to be
spawned programmatically via `slotCtx.openInPopout(appId, seed)` for
single-purpose viewers.

Concrete example: the `file` app is a thin FileViewer that reads
`viewingPath` and `drive` from its instance's persistent state. It's the
target for "open this file in a popout" actions (Files panel pop-out
button, markdown ExternalLink). Spawning a hidden `file` app instead of
a full Files instance keeps the popout chrome-free — no toolbar /
breadcrumb / drive selector inside the floating window — while still
letting the same FileViewer features (edit, copy, switch source/preview)
work.

The `instanceLabel` hook lets a hidden app report a meaningful tab title:
the `file` app returns the basename of `viewingPath`, so multiple file
popouts have distinct, human-readable tabs.

Hidden apps don't expose the popIn button in the floating window — they
have no dock entry to return to, so `popIn` is also a no-op for them at
the SlotContext level. They live and die in the popout layer (close = X).

### Global apps

Apps that surface user-scoped resources rather than ws-scoped ones —
Library, Connectors, Service Tokens, Credentials, Model Providers,
OAuth Apps, Admin. They register the same way as ws apps; the only
thing "global" about them is the content they fetch (user-level API
endpoints, not workspace-level). Several of these are also exposed in
fleet scope via `useFleetApps`.

**Per-instance UI state stays per-instance** (which means per-ws when
mounted in ws scope, fleet-scoped when in fleet). Open Library in ws A
→ select a prompt; open Library in ws B → starts fresh; back to A →
prompt still selected. react-query data underneath is shared across
both (cache keys aren't ws-scoped), only "where am I in the UI" is
per-instance.

Cross-app routing into a global app works through the same pattern as
any other in-shell jump:

```ts
// e.g. TemplateConfigView clicking a referenced prompt name
const { slotId, instanceId } = slotCtx.ensureInstance('library')
setPersistentInstanceState(workspaceId, instanceId, 'librarySection', 'prompts')
setPersistentInstanceState(workspaceId, instanceId, 'promptsSelectedId', promptId)
slotCtx.activate(slotId, instanceId)
```

Sub-nav inside a global app (Library's prompts/skills/templates) is just
another `useInstancePersistentState` key — refresh lands the user back
on the section they were in. App's sub-nav UI is rendered into the
AppWindow header via `useAppHeaderSlot()` portal, so it sits inline with
the app chrome (consistent with Files' drive switcher).

Wrappers in `web/src/components/shell/apps/wsApps.tsx` accept
`AppComponentProps` and forward `instanceId` to the panel:

```tsx
export function FilesApp({ instanceId }: AppComponentProps) {
  const ws = useCurrentWorkspace()
  if (!ws) return null
  if (ws.status !== 'running') return <NotRunning />
  return (
    <Suspense fallback={<AppFallback />}>
      <WorkspaceFilesPanel workspaceId={ws.id} instanceId={instanceId} />
    </Suspense>
  )
}
```

Panels take `({ workspaceId, instanceId })` and use the hooks above.

## AppWindow header portal

Apps inject toolbar content (titles, primary actions, selectors) into the
shared `AppWindow` header via the `useAppHeaderSlot()` portal target.
Convention:

- **Business actions go left-aligned.** The slot is a left-flex region.
  Window controls (popout, fill, fullscreen, close) are on the right and
  managed by the shell — apps never render them.
- **Don't pad with counts or status text** to "fill" the header. Empty
  space is fine; visible padding signals incomplete work, not polish.
- Use `<AppHeaderButton icon={...} label={...} />` for primary actions
  (text+icon) and `<AppHeaderButton icon={...} />` alone for icon-only
  secondary actions. Both are h-7, hover-only background.

```tsx
{headerSlot &&
  createPortal(
    <AppHeaderButton icon={Plus} label={t('...new')} onClick={openCreate} />,
    headerSlot,
  )}
```

## Resource grid pattern

Every "list of user-owned resources" app (providers, credentials,
oauth-apps, connectors, prompts, skills, templates, ...) shares the same
visual building blocks under `components/resource/`:

- **`<ResourceGrid>`** — responsive 1/2/3/4-col grid. Single source of
  truth for column count and gutter so every grid app reads at the same
  rhythm.
- **`<ResourceCard>`** — macOS-style elevation card (no border, soft
  `bg-foreground/[0.04]` overlay, `rounded-xl p-5`). Slots: `name`,
  `description` (line-clamp-2), `type`, `meta`, `scope?`, `owned?`,
  `actions` (hover-revealed top-right).
- **`<ScopeBadge scope="private|team|public" />`** — Lock / Users / Globe
  icon in low-saturation token color. Used on every card that has a
  scope concept.
- **`<ResourceFilterTabs>`** — All / Private / Team / Public segmented
  tabs (always-on for scope-bearing resources, even if some buckets are
  empty). Per-instance persistent state via `useInstancePersistentState`.

### Scope + ownership model

These are two independent dimensions, not collapsed into one chip:

- **scope** (private / team / public): who can access this resource.
  Drives the `<ScopeBadge>` on every card.
- **ownership** (mine / theirs): who can edit. Surfaces a `text-primary`
  "Yours / 您的" tag in the meta row + the hover-only edit/delete
  buttons. Cards without `owned` show neither.

A public provider shared by another user → `scope='public', owned=false`
→ visible to me, no edit buttons, no "Yours" tag. A public provider I
shared myself → `scope='public', owned=true` → "Yours" tag + edit
buttons on hover.

Resources that are inherently single-scope (e.g., credentials are
always user-private) **omit** `scope` and `owned` entirely. The
ScopeBadge slot collapses; the filter tabs aren't rendered. Don't fake
chips for the sake of consistency.

## Dialog registry

Dialogs that may be triggered from multiple call sites (sections, the
Command Palette, markdown link callers) live in
`components/dialogs/Create*Dialog.tsx` and are registered once at app
boot via `components/dialogs/registry.ts`:

```ts
registerDialog('create-provider', CreateProviderDialog)
```

Callers then `useDialogStack().open('create-provider')` from anywhere.
The registry is imported once from `main.tsx`.

**When to register vs. mount locally:**
- **Register** — anything that's a "create new X" action. Cmd+K and
  empty-state CTAs both want to trigger it without remounting.
- **Mount locally** — edit dialogs that need row context (the form
  needs the existing object's data, not a parameter the dialog stack
  can pass). These stay as plain `<Dialog open={editOpen}>` inside the
  section.

Form bodies for create + edit are extracted into a shared
`*FormFields.tsx` component (e.g., `ProviderFormFields`,
`CredentialFormFields`) so polish stays in one place. The component
exports both the JSX and a `validate*Form()` helper that returns
field-keyed errors for inline rendering.

## SegmentedControl vs Tabs

Two patterns, not interchangeable:

- **`<SegmentedControl>`** (`components/ui/segmented-control.tsx`) —
  compact mutually-exclusive selector. Use for filter rows
  (`ResourceFilterTabs` is a thin wrapper) and in-form choice fields
  (preset toggles, key-type pickers). Variants: `pill` (rounded-full,
  filter feel) / `box` (rounded-lg, form feel). Modes: `tabs`
  (role=tablist for filters that drive a sibling view) / `group`
  (aria-pressed for plain form values).
- **shadcn `<Tabs>`** (`components/ui/tabs.tsx`) — Radix-managed
  content-switching tabs with `<TabsContent>` panels, roving focus,
  keyboard nav. Use when you have multiple panels of distinct content
  (e.g., the Library app's Prompts / Skills / Templates sections).

Don't use shadcn Tabs for compact filter chips, and don't use
SegmentedControl when you need `TabsContent` coupling.

## Loading model

Desktop withholds `<SlotProvider>` (and therefore the layout body and
dock items) until the active profile has been fetched at least once,
keyed by `profileId` (the workspace id in ws scope, `FLEET_PROFILE_ID`
in fleet scope):

```ts
const profileId = scope === 'ws' ? workspaceId : FLEET_PROFILE_ID
const profileLoaded = useWorkspaceProfileLoaded(profileId)
```

Without this gate, the first render falls back to `DEFAULT_LAYOUT` and
each layout's `defaultOpened`, then snaps to the user's saved choice
once the profile arrives — visible flash.

## Fleet vs ws scope

Both scopes mount the same `<SlotProvider>` machinery; only the profile
backing and app catalog differ:

| | ws scope | fleet scope |
| --- | --- | --- |
| Route | `/w/:workspaceId` | `/` |
| Profile id | workspace id | `FLEET_PROFILE_ID` |
| Profile backend | API (`/workspaces/:id/profile`) | localStorage (registered via `registerProfileBackend`) |
| Layout | 1/2/3-col, switchable | Fixed 1-col (no LayoutSwitcher in dock) |
| Apps | `useWsApps` (chat / files / terminal / ...) | `useFleetApps` (workspaces grid + global resources) |

`SlotContext` exposes `workspaceId` directly so per-instance state hooks
work in both scopes (fleet routes have no `:workspaceId` URL segment).
Backends are registered via `registerProfileBackend(id, backend)` so
the store stays scope-agnostic.

## URL state

Only `?session=…` is URL-bound (sessions are user-shareable). Layout,
slot active, view position, sub-nav — all flow through the workspace
profile / instance state store, never URL params.

## App authoring recipe

When adding (or refactoring) an app:

1. **Wrapper** in `wsApps.tsx` / `fleetApps.tsx`: take `AppComponentProps`,
   forward `instanceId` to the panel.
2. **Panel signature**: `({ workspaceId, instanceId })`.
3. **State**: classify each `useState` per the persistence rule above.
   Never use URL params for view position — route through `instanceId`.
4. **Multi-instance correctness**: two instances in two slots must
   operate independently — no module-level singletons keyed only by
   workspace.
5. **Server data**: prefer `useQuery` / `useMutation`; the cache replaces
   `useInstanceState` slots that were just holding fetched data.

Reference: `WorkspaceFilesPanel.tsx` (full instance + react-query
example), `WorkspaceMemoryAppPanel.tsx` (smallest example),
`ProvidersSection.tsx` (resource grid pattern + dialog registry).

## Performance notes

- **`<StrictMode>` is on in dev** (`main.tsx`). Every mount triggers a
  mount → unmount → mount cycle in dev only. Don't chase the resulting
  brief lifetimes (`lifetime=1ms` etc.) — they're not present in prod.
- **Streamdown / markdown render cost** is concentrated in first mount
  (shiki grammar load, mermaid, hast→jsx walk). `React.memo` only helps
  for stable-children re-renders; it doesn't help cross-mount. If markdown
  preview feels slow, the costs are real but unavoidable inside Streamdown
  — consider replacing with a leaner renderer or caching rendered output
  by content hash if it becomes a real bottleneck.

## Files of note

```
# Shell + state
web/src/lib/app-registry.ts                  AppDefinition / AppInstance
web/src/contexts/SlotContext.tsx             Slot + instance management
web/src/stores/workspace-profile-store.ts    Profile store w/ pluggable backends
web/src/stores/fleet-profile.ts              Fleet (LS-backed) backend
web/src/stores/instance-state-store.ts       In-memory + persistent instance hooks
web/src/components/shell/Desktop.tsx         Scope routing + bootstrap + load gate
web/src/components/shell/SlotContainer.tsx   Per-slot host (key={instance.id})
web/src/components/shell/PopoutLayer.tsx     Floating window for popout slot
web/src/components/shell/apps/wsApps.tsx     ws-scope app wrappers
web/src/components/shell/apps/fleetApps.tsx  fleet-scope app wrappers
web/src/components/shell/layout/             Layout components & SLOTS
web/src/hooks/useActiveLayout.ts             Layout selector (DB-backed)
web/src/hooks/useWsApps.ts / useFleetApps.ts App registry per scope

# Resource UI building blocks
web/src/components/resource/ResourceCard.tsx
web/src/components/resource/ResourceGrid.tsx
web/src/components/resource/ScopeBadge.tsx
web/src/components/resource/ResourceFilterTabs.tsx
web/src/components/ui/segmented-control.tsx
web/src/components/dialogs/registry.ts       Central dialog registration

# Backend
control-plane/migrations/074_workspace_profile.sql   DB schema
control-plane/src/services/db/workspace-profile.ts   Shallow-merge upsert
control-plane/src/routes/workspaces/profile.ts       GET/PATCH route
internal/types/api.ts                            ApiWorkspaceProfile / WorkspaceProfilePayload
```
