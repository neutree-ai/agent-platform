import { useTheme } from '@/components/ThemeProvider'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { githubLight } from '@uiw/codemirror-theme-github'
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'
import CodeMirror from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef } from 'react'

function getLanguageExtension(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript()
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true })
    case 'jsx':
      return javascript({ jsx: true })
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'py':
      return python()
    case 'json':
    case 'jsonc':
      return json()
    case 'html':
    case 'htm':
      return html()
    case 'css':
    case 'scss':
      return css()
    case 'md':
    case 'mdx':
      return markdown()
    case 'yaml':
    case 'yml':
      return yaml()
    case 'xml':
    case 'svg':
      return xml()
    default:
      return null
  }
}

const cmThemeOverride = EditorView.theme({
  '&': { height: '100%', fontSize: '12px' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-gutters': { borderRight: 'none' },
  '.cm-jumpHighlight': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 22%, transparent)',
    transition: 'background-color 1.4s ease-out',
  },
  '.cm-jumpHighlight-fade': {
    backgroundColor: 'transparent',
  },
})

const setJumpHighlight = StateEffect.define<number | null>()

const jumpHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(deco, tr) {
    let next = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setJumpHighlight)) {
        if (e.value == null) {
          next = Decoration.none
        } else {
          const doc = tr.state.doc
          const lineNo = Math.max(1, Math.min(doc.lines, e.value))
          const line = doc.line(lineNo)
          next = Decoration.set([
            Decoration.line({ attributes: { class: 'cm-jumpHighlight' } }).range(line.from),
          ])
        }
      }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f),
})

interface CodePreviewProps {
  filename: string
  content: string
  isEditing: boolean
  onChange?: (value: string) => void
  /** When true, long lines soft-wrap to the viewport width instead of scrolling. */
  wrap?: boolean
  /** 1-based; scrolls and briefly highlights when set. */
  viewingLine?: number
  /** 1-based; positions cursor within the highlighted line. */
  viewingColumn?: number
}

export function CodePreview({
  filename,
  content,
  isEditing,
  onChange,
  wrap = false,
  viewingLine,
  viewingColumn,
}: CodePreviewProps) {
  const { theme } = useTheme()
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const cmTheme = isDark ? tokyoNight : githubLight

  const langExt = useMemo(() => getLanguageExtension(filename), [filename])
  const extensions = useMemo(() => {
    const exts = [cmThemeOverride, jumpHighlightField]
    if (wrap) exts.push(EditorView.lineWrapping)
    if (langExt) exts.push(langExt)
    return exts
  }, [langExt, wrap])

  const viewRef = useRef<EditorView | null>(null)
  const fadeTimerRef = useRef<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)
  // Per-target sentinel: fire the jump at most once per (file, line, col).
  // Without this, the effect's `content` dep would re-trigger on every
  // keystroke (snapping the caret back) and every background refetch.
  const jumpedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (isEditing) return
    const view = viewRef.current
    if (!view || !viewingLine) return
    const doc = view.state.doc
    if (doc.length === 0) return
    const key = `${filename}:${viewingLine}:${viewingColumn ?? ''}`
    if (jumpedKeyRef.current === key) return
    jumpedKeyRef.current = key
    const lineNo = Math.max(1, Math.min(doc.lines, viewingLine))
    const line = doc.line(lineNo)
    const colOffset = Math.max(0, Math.min(line.length, (viewingColumn ?? 1) - 1))
    const pos = line.from + colOffset
    view.dispatch({
      effects: [EditorView.scrollIntoView(pos, { y: 'center' }), setJumpHighlight.of(lineNo)],
      selection: EditorSelection.cursor(pos),
    })
    if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    fadeTimerRef.current = window.setTimeout(() => {
      viewRef.current?.dom
        .querySelector('.cm-jumpHighlight')
        ?.classList.add('cm-jumpHighlight-fade')
    }, 400)
    clearTimerRef.current = window.setTimeout(() => {
      viewRef.current?.dispatch({ effects: setJumpHighlight.of(null) })
    }, 1800)
    return () => {
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current)
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [viewingLine, viewingColumn, content, isEditing, filename])

  return (
    <div className="relative min-h-0 flex-1">
      <CodeMirror
        className="absolute inset-0"
        value={content}
        readOnly={!isEditing}
        editable={isEditing}
        theme={cmTheme}
        extensions={extensions}
        onChange={isEditing ? onChange : undefined}
        onCreateEditor={(view) => {
          viewRef.current = view
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: isEditing,
          highlightSelectionMatches: true,
          bracketMatching: true,
          searchKeymap: true,
        }}
        height="100%"
      />
    </div>
  )
}
