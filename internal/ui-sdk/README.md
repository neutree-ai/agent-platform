# @neutree-ai/ui-sdk

React components for embedding agent platform UI in your own app:

- **Transcript** — renders an agent session (messages, tool calls) from the platform's wire message format.
- **Composer** — the chat input: send-key handling, `/` commands, `@`-mentions, image attachments, voice input and a queued-follow-up state. Network-free; data comes in through props.
- **Platform composer preset** — wires the Composer to a platform workspace (built-in and workspace commands, `@file/…`, `@skill/…`, `@agent/…`, voice) through a small client you provide.

The package ships compiled ESM plus Tailwind class names; it does no styling of its own beyond those classes.

## Host setup

Peer dependencies: `react` / `react-dom` 18, `i18next`, `react-i18next`, `lucide-react`.

**Tailwind.** Components are styled with Tailwind utilities, so your Tailwind build must scan the package:

```js
// tailwind.config.js
content: ['./src/**/*.{ts,tsx}', './node_modules/@neutree-ai/ui-sdk/dist/**/*.js'],
plugins: [require('tailwindcss-animate')],
```

It also expects:

- **Color tokens** as `oklch` CSS variables wired into `theme.extend.colors` (`primary: 'oklch(var(--primary) / <alpha-value>)'`, …): `background`, `foreground`, `primary`, `secondary`, `destructive`, `muted`, `accent`, `popover`, `card` (each with `-foreground` where applicable), `border`, `input`, `ring`, `info`, `success`, `warning`. The components never use palette colors directly.
- **Font sizes** `mini` (10px / 14px) and `tiny` (11px / 15px) in `theme.extend.fontSize`.
- **`tailwindcss-animate`** for the enter/exit animations (`animate-in`, `fade-in`, `zoom-in-*`).

**Radix singletons.** Tooltips and dialogs are Radix primitives with module-scoped React context. Wrap your app once in a tooltip provider (the SDK re-exports `TooltipProvider` if you don't have one), and make sure your bundler resolves a single copy of each shared package. With Vite:

```ts
resolve: {
  dedupe: [
    'react', 'react-dom', 'react-i18next', 'i18next', 'lucide-react',
    '@radix-ui/react-tooltip', '@radix-ui/react-collapsible',
    '@radix-ui/react-dialog', '@radix-ui/react-slot',
  ],
},
```

**i18n.** The SDK owns a private i18next instance with `en-US` and `zh-CN` bundles and never touches yours. Transcript components read it through `<TranscriptI18nProvider locale="…">`; the Composer binds it directly, so pass `locale` to the Composer (or render a `TranscriptI18nProvider` anywhere to set the SDK language). Anything `zh-*` maps to `zh-CN`, everything else to `en-US`.

## Composer

```tsx
import { Composer, type ComposerHandle } from '@neutree-ai/ui-sdk'

const ref = useRef<ComposerHandle>(null)

<Composer
  ref={ref}
  value={text}
  onChange={setText}
  onSubmit={(text, images) => send(text, images)}
  running={agentIsWorking}
  onStop={stop}
  sendKey="mod-enter"
  locale="en-US"
/>
```

The Composer is controlled and never clears its own input or attachments; the host does that after a submit.

| Prop | Purpose |
| --- | --- |
| `value` / `onChange` | Controlled text. |
| `onSubmit(text, attachments)` | Submit. While `running`, a submit means "queue this" — the host decides what that does. Empty text is allowed when images are attached. |
| `onRunCommand(text, command)` | Run an expanded slash command (input already cleared). Defaults to `onSubmit(text, [])`. |
| `onStop` | Shows a stop button while `running`. |
| `running` | The agent is working: the toolbar collapses, submits become queue requests, a busy strip appears. |
| `allowQueue` | Default `true`. When `false`, submitting while running is ignored and no queue UI renders. |
| `pending` | `{ dirty, onDiscard? }` for a queued follow-up: tints the composer, shows the queued pill and a discard button. |
| `disabled` | Blocks submitting and the toolbar. |
| `readOnly` | Read-only text, no actions or menus. |
| `sendKey` | `'mod-enter'` (⌘/Ctrl+Enter sends) or `'enter'` (Enter sends, Shift+Enter newline). On touch-first devices Enter always inserts a newline and the send button sends. |
| `placeholder` | Overrides the send-key-aware default. |
| `attachments` | `{ items, onAdd, onRemove, accept? }`. Enables the attach button and image paste; `onAdd` receives base64 `{ data, media_type }` items. |
| `voice` | `{ transcribe(blob), shortcut?, onError? }`. Mic button with record / stop / cancel. `shortcut: true` opts this composer into the page-wide ⌘/Ctrl+Shift+M toggle — enable it on at most one composer per page. |
| `commands` / `loadCommands` | Slash commands. `commands` show immediately; `loadCommands()` runs each time the `/` menu opens and its results are appended. |
| `triggers` | Caret-anchored suggestion sources (see below). |
| `toolbar` / `header` | Extra controls in the bottom-left toolbar (hidden while running) / content above the input. |
| `locale`, `className`, `textareaClassName` | Language of the Composer's strings; styling hooks. |

The ref exposes `focus({ caret: 'end' }?)`, `insertAtCaret(text)` (splices text in at the caret with word padding, then restores focus — handy for "add to chat" actions elsewhere on the page) and `textarea`.

**Commands.** `{ name, type: 'plain' | 'struct', content, description?, icon? }`. The `/` menu opens when the whole input is a single `/…` line. `plain` commands send `content`; `struct` commands open a form with one field per `{{variable}}` in `content` and send the resolved text. Expansion is client-side — the agent only ever receives plain text.

**Triggers.** A trigger matches the text before the caret and suggests replacements:

```ts
const tagTrigger: ComposerTrigger = {
  id: 'tags',
  pattern: /#([\w-]*)$/,          // anchored at the caret; group 1 is the query
  debounceMs: 150,                // delay for non-empty queries
  getItems: async (query, signal) =>
    (await searchTags(query, { signal })).map((tag) => ({
      key: tag.id,
      label: `#${tag.name}`,
      insertText: `#${tag.name} `,
    })),
}
```

Items may set `keepOpen` to leave the menu open after inserting (e.g. drilling into a folder). When several triggers match, the one starting closest to the caret wins. Menus are an ARIA listbox driven from the textarea (`aria-activedescendant`); ↑/↓ move, Enter/Tab pick, Esc dismisses, and IME composition never picks or submits.

## Platform composer preset

`useNapComposer` (or the non-hook `createNapComposerPreset`) returns `commands`, `loadCommands`, `triggers` and `voice` to spread onto the Composer:

```tsx
import { Composer, createNapHttpClient, useNapComposer } from '@neutree-ai/ui-sdk'

const client = useMemo(
  () => createNapHttpClient({ baseUrl: '/agent-api', workspaceId }),
  [workspaceId],
)
const sources = useNapComposer({
  client,
  agentType,                 // e.g. 'claude-code'; built-ins the core can't run are left out
  workspaceId,               // hides the current workspace from @agent suggestions
  include: { agents: false, builtinCommands: { 'create-skill': false } },
  commands: myExtraCommands, // appended after the built-ins
  voice: { shortcut: true },
})

<Composer value={text} onChange={setText} onSubmit={send} {...sources} />
```

Sources, each on by default and switched off through `include`:

| Source | Needs | Behavior |
| --- | --- | --- |
| `builtinCommands` | — | `compact` (sends `/compact`), `goal` (form → `/goal <condition>`), `create-skill` (form → a prompt that drives the platform's skill tools). `compact` and `goal` are only offered on agent cores that parse slash commands (all but `dsh`); see `isNapBuiltinCommandSupported`. `NAP_BUILTIN_COMMAND_NAMES` lists the reserved names. |
| `workspaceCommands` | `listCommands` | The workspace's commands; prompt-library content wins over inline content; disabled ones are skipped. |
| `files` | `listDir` | `@file/<path>` with folder drill-down and recursive search. |
| `skills` | `listSkills` | `@skill/<name>` for the workspace's attached skills, searched by name and description. A bare `@` also offers the `@skill/` entry and, once a name is typed, the matching skills. |
| `agents` | `listCallableAgents` | `@agent/<slug>` or `@agent/<owner>/<slug>`. A bare `@` also offers the `@file/` entry. |
| `voice` | `transcribe` | Speech to text. |

### Client interface

```ts
interface NapComposerClient {
  listCommands?(): Promise<NapWorkspaceCommand[]>          // GET  /workspaces/:id/commands → { commands }
  listSkills?(): Promise<NapWorkspaceSkill[]>              // GET  /workspaces/:id/skills → { skills }
  listCallableAgents?(): Promise<NapCallableAgent[]>       // GET  /workspaces/callable
  listDir?(dir: string, query: string, signal?: AbortSignal): Promise<NapDirEntry[]>
                                                           // GET  /workspaces/:id/agent/dirs?path=&q= → { entries }
  transcribe?(audio: Blob, options?: { language?: string; hint?: string }): Promise<string>
                                                           // POST /asr/transcribe (multipart: audio, language?, hint?) → { text }
}
```

Every method is optional; a source whose method is missing is left out. `createNapHttpClient({ baseUrl, workspaceId, headers?, credentials?, fetch? })` implements all of them over those paths. The preset caches callable agents and skills (30 s, stale-while-revalidate) and directory listings (10 s); commands are fetched each time the `/` menu opens, so put caching in your client if you want it.

### External apps: go through your own backend

An app outside the platform should not hand a platform credential to the browser. Instead, expose a narrow proxy on your backend and point `createNapHttpClient` (or your own client) at it:

- **Allow-list exactly these calls** — `GET …/commands`, `GET …/skills`, `GET …/callable`, `GET …/agent/dirs`, `POST …/asr/transcribe` — and reject everything else.
- **Pin the workspace server-side.** Ignore any workspace id the browser sends; substitute the one your app is bound to, and call the platform with a service token (Bearer) that only your backend holds.
- **Pass the platform's responses through unchanged** (status and JSON body), so error messages still reach the user.
- If your app doesn't need a source (e.g. `@agent/…`), don't proxy it and switch it off with `include`.

For example, with the proxy mounted at `/agent-api`, `createNapHttpClient({ baseUrl: '/agent-api', workspaceId: 'pinned' })` works as-is: the proxy maps `/agent-api/workspaces/pinned/commands` to the real workspace.

## Session

The platform web app's session store, shared: `createAgentSessionStore(workspaceId, deps)`. It is a zustand store; read it with `useStore` from `zustand`. It loads a session's history and streams the running turn, rendering text, tool calls and status lines as they arrive. It also handles:

- reattaching to a turn after a reload;
- queued follow-ups;
- questions (`pendingQuestion`, `respondToQuestion`);
- interrupting.

`syncRemoteTurn` catches up with turns started elsewhere: the results of agent calls, or other people. Call it with `useRemoteTurnSync({ enabled, syncRemoteTurn })` while the session waits on agents (`pending_agent_calls > 0`). It checks every 5 s.

`deps`:

- `api`: session, messages, pending message, pending question, respond, interrupt, delete.
- `sse`: `createAgentChat` and `createCPReconnectStream` from this package.
- `effects`: what the host does when a session is created or a turn completes.
- `drafts`, `toolResults`: optional.

The chat and reconnect requests go to `/api` and `/_proxy` on the page's origin. An app outside the platform proxies those paths through its own backend, which pins the workspace and adds the service token. It points the SDK at the proxy once at start-up:

```ts
configureSessionEndpoints({ apiUrl: '/my-backend/nap', proxyUrl: '/my-backend/nap/_proxy' })
```
