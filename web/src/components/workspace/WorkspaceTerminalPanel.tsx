import '@xterm/xterm/css/xterm.css'
import { AppHeaderButton } from '@/components/shell/windows/AppHeaderButton'
import { useAppHeaderSlot } from '@/components/shell/windows/AppWindow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import i18n from '@/lib/i18n'
import { isCommitEnter } from '@/lib/keyboard'
import { useInstanceState } from '@/stores/instance-state-store'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronUp, RefreshCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useTerminalTheme } from './terminal-themes'

type WsState = 'connecting' | 'open' | 'closed' | 'error'

interface WorkspaceTerminalPanelProps {
  workspaceId: string
  instanceId: string
}

// ttyd binary protocol: first byte is ASCII command character
// server→client: '0'=output, '1'=set title, '2'=set preferences
// client→server: '0'=input, '1'=resize, '2'=pause, '3'=resume
const CMD_OUTPUT = 0x30 // '0'
const CMD_INPUT = 0x30 // '0'
const CMD_RESIZE = 0x31 // '1'

const textEncoder = new TextEncoder()

// ttyd/libwebsockets fragments a single client→server frame once it grows past
// its receive buffer (~2KB observed), then mis-parses the continuation frame's
// first byte as a tty command and tears down the connection. So a large paste
// sent as one frame silently kills the terminal. Split outgoing input into
// sub-buffer-size chunks; xterm.js does no input-side chunking or flow control
// itself (its flow-control guide covers the write/output path only).
const TERMINAL_INPUT_CHUNK_SIZE = 1024
// Pause feeding more chunks while the socket's send buffer is backed up, so a
// huge paste can't balloon memory faster than the wire drains it.
const WS_BACKPRESSURE_LIMIT = 1 << 20 // 1 MiB

function sendInputFrame(ws: WebSocket, payload: Uint8Array) {
  const msg = new Uint8Array(1 + payload.length)
  msg[0] = CMD_INPUT
  msg.set(payload, 1)
  ws.send(msg)
}

function waitForDrain(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount < WS_BACKPRESSURE_LIMIT) {
        resolve()
      } else {
        setTimeout(check, 4)
      }
    }
    check()
  })
}

export function WorkspaceTerminalPanel({ workspaceId, instanceId }: WorkspaceTerminalPanelProps) {
  const { t } = useTranslation()
  const terminalTheme = useTerminalTheme()
  const headerSlot = useAppHeaderSlot()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const disposablesRef = useRef<Array<{ dispose(): void }>>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  // In-memory instance state — search draft survives layout switches but
  // isn't worth persisting: the WS-backed scrollback it would search
  // against doesn't survive refresh either.
  const [searchTerm, setSearchTerm] = useInstanceState<string>(instanceId, 'searchTerm', () => '')

  // Component-local — pure render-cycle transients.
  const [connectKey, setConnectKey] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [wsState, setWsState] = useState<WsState>('connecting')
  // null = never searched (or term changed since last search). Counter / disabled
  // states key off this to avoid flashing "No match" while the user is still typing.
  const [searchResults, setSearchResults] = useState<{
    index: number
    count: number
  } | null>(null)

  const reconnect = useCallback(() => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    // Clear terminal and trigger new connection
    const term = termRef.current
    if (term) {
      term.clear()
      term.write(
        `\x1b[90m[${i18n.t('components.workspaceTerminal.messages.reconnecting')}]\x1b[0m\r\n`,
      )
    }
    setConnectKey((k) => k + 1)
  }, [])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    // Focus after render
    queueMicrotask(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }, [])

  const findNext = useCallback(() => {
    const addon = searchRef.current
    if (!addon || !searchTerm) return
    addon.findNext(searchTerm, { decorations: decorationOptions() })
  }, [searchTerm])

  const findPrevious = useCallback(() => {
    const addon = searchRef.current
    if (!addon || !searchTerm) return
    addon.findPrevious(searchTerm, { decorations: decorationOptions() })
  }, [searchTerm])

  // Create terminal once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      fontFamily: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
      theme: terminalTheme,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    // Cmd/Ctrl+click on URLs in terminal output. Default handler opens in
    // a new tab — matches Terminal.app / iTerm2 / VS Code behavior.
    const webLinksAddon = new WebLinksAddon()
    // Proper width calculation for CJK / emoji — without this, Chinese
    // characters in the terminal misalign with the cell grid.
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'
    term.open(container)

    // WebGL renderer — sharper text + much faster scrolling on long output.
    // Falls back to the DOM renderer automatically if the GPU context is
    // lost (e.g., user switches GPU, browser revokes WebGL).
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      term.loadAddon(webglAddon)
    } catch {
      // WebGL unavailable — DOM renderer keeps working.
    }

    const resultsDisposable = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResults({ index: resultIndex, count: resultCount })
    })

    try {
      fitAddon.fit()
    } catch {}

    // Intercept Ctrl/Cmd+F to open search bar
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        queueMicrotask(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        })
        return false
      }
      return true
    })

    termRef.current = term
    fitRef.current = fitAddon
    searchRef.current = searchAddon

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {}
    })
    observer.observe(container)
    observerRef.current = observer

    return () => {
      resultsDisposable.dispose()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      observerRef.current = null
    }
  }, [workspaceId])

  // Re-apply terminal theme when global light/dark changes, or when search
  // opens/closes. xterm SearchAddon marks the active match by calling
  // terminal.select() (not via decorations) — so the active match always
  // reads as the *selection* color. While the search bar is open we swap
  // selectionBackground to the active-match accent so the current hit
  // visually stands out from the yellow match decorations; restore on close
  // so manual text selection looks normal again.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = searchOpen
      ? {
          ...terminalTheme,
          selectionBackground: ACTIVE_MATCH_BG,
          // Force a dark fg under the orange selection so the active match
          // text stays readable regardless of the active terminal palette
          // (which usually leaves selectionForeground unset → text keeps its
          // own ANSI color, which can collide with orange).
          selectionForeground: ACTIVE_MATCH_FG,
        }
      : terminalTheme
  }, [terminalTheme, searchOpen])

  // Connect/reconnect WebSocket
  useEffect(() => {
    const term = termRef.current
    if (!term) return

    // Clean up previous connection disposables
    for (const d of disposablesRef.current) d.dispose()
    disposablesRef.current = []

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    // ?session=<instanceId> picks the per-slot tmux session on the agent
    // pod. Each panel slot gets its own session so opening multiple terminal
    // apps gives independent shells (and reattach restores scrollback +
    // long-running commands instead of joining whoever else is on `main`).
    const wsUrl = `${proto}//${location.host}/api/workspaces/${workspaceId}/agent/terminal/ws?session=${encodeURIComponent(
      instanceId,
    )}`
    const ws = new WebSocket(wsUrl, ['tty'])
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    setWsState('connecting')

    ws.onopen = () => {
      const handshake = JSON.stringify({
        AuthToken: '',
        columns: term.cols,
        rows: term.rows,
      })
      ws.send(textEncoder.encode(handshake))
      setWsState('open')
    }

    ws.onmessage = (evt) => {
      const buf = new Uint8Array(evt.data as ArrayBuffer)
      if (buf.length < 1) return
      if (buf[0] === CMD_OUTPUT) {
        term.write(buf.slice(1))
      }
    }

    ws.onclose = () => {
      setWsState((s) => (s === 'error' ? 'error' : 'closed'))
      term.write(
        `\r\n\x1b[90m[${i18n.t('components.workspaceTerminal.messages.connectionClosed')}]\x1b[0m\r\n`,
      )
    }

    ws.onerror = () => {
      setWsState('error')
      term.write(
        `\r\n\x1b[31m[${i18n.t('components.workspaceTerminal.messages.connectionError')}]\x1b[0m\r\n`,
      )
    }

    // Serialize sends so a large paste's chunks stay in order ahead of any
    // keystrokes typed while it's still streaming. Swallow rejections (e.g.
    // socket closing mid-send) so one failure doesn't stall the chain.
    let sendChain: Promise<void> = Promise.resolve()
    const enqueueSend = (task: () => void | Promise<void>) => {
      sendChain = sendChain.then(task).catch(() => {})
    }

    const inputDisposable = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const payload = textEncoder.encode(data)
      // Fast path: typical keystrokes fit in one frame.
      if (payload.length <= TERMINAL_INPUT_CHUNK_SIZE) {
        enqueueSend(() => {
          if (ws.readyState === WebSocket.OPEN) sendInputFrame(ws, payload)
        })
        return
      }
      // Large input (paste): split into sub-buffer-size frames, pausing on
      // backpressure. Splitting mid-UTF-8/mid-escape is safe — ttyd writes each
      // payload to the pty in order, so the byte stream reassembles downstream.
      enqueueSend(async () => {
        for (let offset = 0; offset < payload.length; offset += TERMINAL_INPUT_CHUNK_SIZE) {
          if (ws.readyState !== WebSocket.OPEN) return
          if (ws.bufferedAmount >= WS_BACKPRESSURE_LIMIT) await waitForDrain(ws)
          sendInputFrame(ws, payload.subarray(offset, offset + TERMINAL_INPUT_CHUNK_SIZE))
        }
      })
    })

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        sendResize(ws, cols, rows)
      }
    })

    disposablesRef.current = [inputDisposable, resizeDisposable]

    return () => {
      ws.close()
      wsRef.current = null
      for (const d of disposablesRef.current) d.dispose()
      disposablesRef.current = []
    }
  }, [workspaceId, connectKey])

  return (
    <>
      {headerSlot &&
        createPortal(
          <>
            <Badge
              variant={
                wsState === 'open' ? 'success' : wsState === 'error' ? 'destructive' : 'secondary'
              }
              className="h-4 shrink-0 px-1 text-mini font-medium"
            >
              {t(`components.workspaceTerminal.status.${wsState}`)}
            </Badge>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-foreground/[0.10]" />
            <AppHeaderButton
              icon={Search}
              label={t('components.workspaceTerminal.actions.search')}
              title={t('components.workspaceTerminal.actions.searchHint')}
              onClick={openSearch}
            />
            <AppHeaderButton
              icon={RefreshCw}
              label={t('components.workspaceTerminal.actions.reconnect')}
              onClick={reconnect}
            />
          </>,
          headerSlot,
        )}
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          {searchOpen && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-foreground/[0.08] bg-popover py-1 pl-2.5 pr-1 shadow-lg">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <Input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setSearchResults(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeSearch()
                  } else if (isCommitEnter(e)) {
                    e.preventDefault()
                    if (e.shiftKey) findPrevious()
                    else findNext()
                  }
                }}
                placeholder={t('components.workspaceTerminal.search.placeholder')}
                className="h-7 w-48 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0 focus-visible:border-0"
              />
              {searchResults && (
                <span className="shrink-0 select-none px-1 text-mini tabular-nums text-muted-foreground">
                  {searchResults.count > 0
                    ? `${searchResults.index + 1}/${searchResults.count}`
                    : t('components.workspaceTerminal.search.noMatch')}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={findPrevious}
                disabled={!searchTerm || searchResults?.count === 0}
                title={t('components.workspaceTerminal.search.previous')}
                className="h-6 w-6 hover:bg-foreground/[0.06] [&_svg]:size-3.5"
              >
                <ChevronUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={findNext}
                disabled={!searchTerm || searchResults?.count === 0}
                title={t('components.workspaceTerminal.search.next')}
                className="h-6 w-6 hover:bg-foreground/[0.06] [&_svg]:size-3.5"
              >
                <ChevronDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeSearch}
                title={t('components.workspaceTerminal.search.close')}
                className="h-6 w-6 hover:bg-foreground/[0.06] [&_svg]:size-3.5"
              >
                <X />
              </Button>
            </div>
          )}
          <div
            ref={containerRef}
            className="absolute inset-0 px-2 pb-2"
            style={{ backgroundColor: terminalTheme.background }}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
      </div>
    </>
  )
}

function sendResize(ws: WebSocket, cols: number, rows: number) {
  const json = textEncoder.encode(JSON.stringify({ columns: cols, rows }))
  const msg = new Uint8Array(1 + json.length)
  msg[0] = CMD_RESIZE
  msg.set(json, 1)
  ws.send(msg)
}

// Search-match decoration colors. xterm SearchAddon spec requires #RRGGBB
// (no alpha), and the addon internally relies on different hex values per
// state to render activity — same-hue-different-alpha schemes silently
// merge. So we use two clearly distinct hues: yellow for matches, orange
// for the active match. Mirrors xterm.js's own demo defaults.
const MATCH_BG = '#ffff00' // yellow — non-active matches
const MATCH_BORDER = '#a17f00' // muted gold outline
const ACTIVE_MATCH_BG = '#ff8c00' // dark orange — current match (different hue)
const ACTIVE_MATCH_FG = '#000000' // black text on orange — high-contrast pair
const ACTIVE_MATCH_BORDER = '#000000'

function decorationOptions() {
  return {
    matchBackground: MATCH_BG,
    matchBorder: MATCH_BORDER,
    matchOverviewRuler: MATCH_BG,
    activeMatchBackground: ACTIVE_MATCH_BG,
    activeMatchBorder: ACTIVE_MATCH_BORDER,
    activeMatchColorOverviewRuler: ACTIVE_MATCH_BG,
  }
}
