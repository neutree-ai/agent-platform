import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { isComposing } from '@/lib/keyboard'
import { colLabel } from '@/lib/spreadsheet'
import { cn } from '@/lib/utils'
import type { Cell, CellValue, Color, Workbook } from 'hucre'
import type { RoundtripWorkbook } from 'hucre/xlsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import DataGrid, {
  type Column,
  type RenderCellProps,
  type RenderEditCellProps,
} from 'react-data-grid'
import { useTranslation } from 'react-i18next'
import 'react-data-grid/lib/styles.css'
import './XlsxPreview.css'

// hucre — lazy-loaded on first xlsx open. Tree-shakable subpath keeps the
// CSV/ODS/JSON code out of this bundle.
let xlsxModulePromise: Promise<typeof import('hucre/xlsx')> | null = null
function loadXlsxModule() {
  if (!xlsxModulePromise) xlsxModulePromise = import('hucre/xlsx')
  return xlsxModulePromise
}

interface CellRenderStyle {
  bg?: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: number
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
  borderTop?: string
  borderBottom?: string
  borderLeft?: string
  borderRight?: string
  /** Render newlines as line breaks (xlsx alignment.wrapText). */
  wrap?: boolean
}

interface ParsedCell {
  value: string
  style: CellRenderStyle
}

interface ParsedSheet {
  name: string
  rows: ParsedCell[][]
  columnWidths: number[]
  rowHeights: number[]
}

// Conversions:
//   xlsx column "width" is in characters of the default font's "0".
//   ~7px per char + a small padding lines up with Excel reasonably well.
//   xlsx row height is in points; px = pt * 4/3.
const DEFAULT_COL_PX = 96
const DEFAULT_ROW_PX = 22
const HEADER_ROW_PX = 24
const ROW_GUTTER_PX = 40
// Cap honored row heights — tall xlsx rows are usually set for wrapText, which
// we don't render, so respecting the raw height would just leave huge empty
// space inside each cell.
const MAX_ROW_PX = 32
// Serialization debounce for inline edits. Each writeXlsx call re-zips the
// workbook; 300ms keeps keystroke latency low while still coalescing bursts.
const SAVE_DEBOUNCE_MS = 300

function colWidthToPx(w: number | undefined): number {
  if (!w) return DEFAULT_COL_PX
  return Math.round(w * 7 + 8)
}
function rowHeightToPx(h: number | undefined, wrap: boolean): number {
  if (!h) return DEFAULT_ROW_PX
  const px = Math.max(20, Math.round((h * 4) / 3))
  return wrap ? px : Math.min(px, MAX_ROW_PX)
}

// Apply Excel's tint algorithm against an HSL luminance derived from the
// base RGB. This is the only way theme colors render correctly — most
// xlsx in the wild use theme refs + tint instead of explicit RGB.
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [h * 60, s, l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (h % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
function applyTint(hex: string, tint: number): string {
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const [h, s, l] = rgbToHsl(r, g, b)
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const [nr, ng, nb] = hslToRgb(h, s, Math.max(0, Math.min(1, l2)))
  return `${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

function resolveColor(
  c: Color | undefined,
  themePalette: string[] | undefined,
): string | undefined {
  if (!c) return undefined
  if (c.rgb) return `#${c.rgb}`
  if (typeof c.theme === 'number' && themePalette?.[c.theme]) {
    const base = themePalette[c.theme]
    const hex = base.length === 8 ? base.slice(2) : base
    if (c.tint) return `#${applyTint(hex, c.tint)}`
    return `#${hex}`
  }
  return undefined
}

function borderEdge(
  side: { style: string; color?: Color } | undefined,
  themePalette: string[] | undefined,
): string | undefined {
  if (!side?.style) return undefined
  const color = resolveColor(side.color, themePalette) ?? '#d1d5db'
  switch (side.style) {
    case 'thin':
    case 'hair':
      return `1px solid ${color}`
    case 'medium':
      return `2px solid ${color}`
    case 'thick':
      return `3px solid ${color}`
    case 'dashed':
    case 'mediumDashed':
      return `1px dashed ${color}`
    case 'dotted':
      return `1px dotted ${color}`
    case 'double':
      return `3px double ${color}`
    default:
      return `1px solid ${color}`
  }
}

function alignFromHorizontal(h: string | undefined): CellRenderStyle['textAlign'] {
  if (h === 'center') return 'center'
  if (h === 'right') return 'right'
  if (h === 'left') return 'left'
  return undefined
}

function cellValueToString(cell: Cell | undefined, fallback: unknown): string {
  if (cell?.richText?.length) return cell.richText.map((r) => r.text).join('')
  const raw = cell?.value ?? fallback
  if (raw == null) return ''
  if (raw instanceof Date) return raw.toLocaleDateString()
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw)
  }
  if (cell?.formulaResult != null) return String(cell.formulaResult)
  return ''
}

function extractCellStyle(
  cell: Cell | undefined,
  themePalette: string[] | undefined,
): CellRenderStyle {
  const style: CellRenderStyle = {}
  const s = cell?.style
  if (!s) return style
  const fill = s.fill
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = resolveColor(fill.fgColor, themePalette)
    if (bg) style.bg = bg
  }
  const font = s.font
  if (font) {
    if (font.bold) style.bold = true
    if (font.italic) style.italic = true
    if (font.underline) style.underline = true
    if (typeof font.size === 'number') style.fontSize = font.size
    if (font.name) style.fontFamily = font.name
    const fc = resolveColor(font.color, themePalette)
    if (fc) style.color = fc
  }
  if (s.alignment) {
    const ta = alignFromHorizontal(s.alignment.horizontal)
    if (ta) style.textAlign = ta
    if (s.alignment.wrapText) style.wrap = true
  }
  if (s.border) {
    style.borderTop = borderEdge(s.border.top, themePalette)
    style.borderBottom = borderEdge(s.border.bottom, themePalette)
    style.borderLeft = borderEdge(s.border.left, themePalette)
    style.borderRight = borderEdge(s.border.right, themePalette)
  }
  return style
}

function buildParsedSheets(wb: Workbook): ParsedSheet[] {
  const themePalette = wb.themeColors
  return wb.sheets.map((sheet) => {
    const rowCount = sheet.rows.length
    let colCount = 0
    for (const row of sheet.rows) if (row.length > colCount) colCount = row.length
    if (sheet.columns) colCount = Math.max(colCount, sheet.columns.length)

    const columnWidths: number[] = []
    for (let c = 0; c < colCount; c++) {
      columnWidths.push(colWidthToPx(sheet.columns?.[c]?.width))
    }
    const rowHeights: number[] = []
    const rows: ParsedCell[][] = []
    for (let r = 0; r < rowCount; r++) {
      // wrapText is per-cell; the row is "wrap" if any cell asks for it. Only
      // then does the raw xlsx height get honored — otherwise it's capped.
      let rowWraps = false
      const cells: ParsedCell[] = []
      for (let c = 0; c < colCount; c++) {
        const cell = sheet.cells?.get(`${r},${c}`)
        const fallback = sheet.rows[r]?.[c]
        if (cell?.style?.alignment?.wrapText) rowWraps = true
        cells.push({
          value: cellValueToString(cell, fallback),
          style: extractCellStyle(cell, themePalette),
        })
      }
      rowHeights.push(rowHeightToPx(sheet.rowDefs?.get(r)?.height, rowWraps))
      rows.push(cells)
    }
    return { name: sheet.name, rows, columnWidths, rowHeights }
  })
}

// User input goes through a tiny coercion ladder so numeric strings round-trip
// as numbers (the natural Excel behavior). Everything else stays as a string;
// the empty string becomes a null cell so writers can omit the cell entirely.
function coerceUserInput(raw: string): { value: CellValue; type: Cell['type'] } {
  if (raw === '') return { value: null, type: 'empty' }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw)
    if (!Number.isNaN(n)) return { value: n, type: 'number' }
  }
  return { value: raw, type: 'string' }
}

type GridRow = { __rowIdx: number; cells: ParsedCell[] }

// The bordered surface fills the cell edge-to-edge so any xlsx-declared border
// lands on the cell's outer edge (no inner padding gap that would make cells
// look like floating cards). Text padding sits on an inner element.
function StyledCell({ row, column }: RenderCellProps<GridRow>) {
  const ci = Number(column.key)
  const cell = row.cells[ci]
  if (!cell) return null
  const s = cell.style
  return (
    <div
      className="absolute inset-0 flex items-center overflow-hidden"
      style={{
        backgroundColor: s.bg,
        borderTop: s.borderTop,
        borderBottom: s.borderBottom,
        borderLeft: s.borderLeft,
        borderRight: s.borderRight,
      }}
    >
      <div
        className={cn(
          'w-full px-2 leading-tight',
          s.wrap ? 'whitespace-pre-wrap break-words' : 'truncate',
        )}
        style={{
          color: s.color,
          fontWeight: s.bold ? 600 : undefined,
          fontStyle: s.italic ? 'italic' : undefined,
          textDecoration: s.underline ? 'underline' : undefined,
          fontSize: s.fontSize ? `${s.fontSize}px` : undefined,
          fontFamily: s.fontFamily,
          textAlign: s.textAlign,
        }}
        title={cell.value}
      >
        {cell.value}
      </div>
    </div>
  )
}

function StyledEditCell({ row, column, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
  const ci = Number(column.key)
  const initial = row.cells[ci]?.value ?? ''
  const [value, setValue] = useState(initial)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Cursor placement on entry: Excel sends the caret to the end of the
  // existing value (vs. an `<input>` autoFocus which selects everything).
  // We mirror that — feels less destructive when the user double-clicks to
  // append rather than replace.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  const commit = (commitChanges: boolean) => {
    if (!commitChanges) {
      onClose(false)
      return
    }
    const nextCells = row.cells.slice()
    nextCells[ci] = { ...nextCells[ci], value }
    onRowChange({ ...row, cells: nextCells }, true)
  }
  return (
    <textarea
      ref={taRef}
      // biome-ignore lint/a11y/noAutofocus: edit cell is opened in response to a user gesture (double-click / Enter), and the textarea must receive focus immediately for the editor to be useful
      autoFocus
      rows={1}
      // The editor extends downward over neighboring rows when content runs to
      // multiple lines — capped so a very long value scrolls rather than
      // pushing the whole grid around. Matches Excel's "expand the active row
      // while editing, but only so far" behavior.
      className="absolute left-0 top-0 z-10 w-full resize-none overflow-auto bg-background px-2 text-sm leading-tight outline-none ring-2 ring-primary ring-inset"
      style={{ minHeight: '100%', maxHeight: 160 }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(true)}
      onKeyDown={(e) => {
        // Excel convention: plain Enter commits; any modifier + Enter inserts
        // a literal newline. Shift/Alt/Cmd/Ctrl all qualify so the behavior
        // matches whichever shortcut the user's muscle memory expects.
        //
        // stopPropagation is critical: react-data-grid listens for Enter at
        // the grid container and would otherwise close the editor even when
        // we want the textarea to insert a newline.
        if (e.key === 'Enter') {
          e.stopPropagation()
          if (isComposing(e) || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
          e.preventDefault()
          commit(true)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          e.preventDefault()
          commit(false)
        }
      }}
    />
  )
}

function RowNumberCell({ row }: RenderCellProps<GridRow>) {
  return (
    <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-muted-foreground/80">
      {row.__rowIdx + 1}
    </div>
  )
}

interface XlsxPreviewProps {
  fileUrl: string
  isEditing?: boolean
  /** Called with the freshly serialized xlsx bytes after an inline edit. */
  onBytesChange?: (bytes: Uint8Array) => void
  /** Click handler for the "Open in Office mode" fallback. When omitted the affordance is hidden. */
  onOpenOfficeMode?: () => void
}

export function XlsxPreview({
  fileUrl,
  isEditing = false,
  onBytesChange,
  onOpenOfficeMode,
}: XlsxPreviewProps) {
  const { t } = useTranslation()
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Workbook ref carries the full roundtrip-capable workbook so saveXlsx can
  // regenerate the bytes without losing parts we don't render (drawings,
  // pivot tables, etc).
  const workbookRef = useRef<RoundtripWorkbook | null>(null)
  // Track the request so a late-arriving response doesn't overwrite a newer
  // file's parsed sheets when the user opens a different xlsx mid-flight.
  const reqIdRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = ++reqIdRef.current
    setSheets(null)
    setError(null)
    setActiveIdx(0)
    workbookRef.current = null
    ;(async () => {
      try {
        const resp = await fetch(fileUrl)
        if (!resp.ok) throw new Error(`${resp.status}`)
        const buf = await resp.arrayBuffer()
        const { openXlsx } = await loadXlsxModule()
        const wb = await openXlsx(new Uint8Array(buf), { readStyles: true })
        if (reqIdRef.current !== id) return
        workbookRef.current = wb
        setSheets(buildParsedSheets(wb))
      } catch (err) {
        if (reqIdRef.current !== id) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [fileUrl])

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    },
    [],
  )

  const active = sheets?.[activeIdx]
  const editable = isEditing && !!onBytesChange

  const columns = useMemo<Column<GridRow>[]>(() => {
    if (!active) return []
    const gutter: Column<GridRow> = {
      key: '__row',
      name: '',
      width: ROW_GUTTER_PX,
      minWidth: ROW_GUTTER_PX,
      maxWidth: ROW_GUTTER_PX,
      frozen: true,
      resizable: false,
      cellClass: 'rdg-xlsx-row-gutter',
      headerCellClass: 'rdg-xlsx-row-gutter',
      renderCell: RowNumberCell,
    }
    const body = active.columnWidths.map<Column<GridRow>>((w, ci) => ({
      key: String(ci),
      name: colLabel(ci),
      width: w,
      resizable: true,
      renderCell: StyledCell,
      renderEditCell: editable ? StyledEditCell : undefined,
    }))
    return [gutter, ...body]
  }, [active, editable])

  const gridRows = useMemo<GridRow[]>(() => {
    if (!active) return []
    return active.rows.map((cells, i) => ({ __rowIdx: i, cells }))
  }, [active])

  const handleRowsChange = (
    newRows: GridRow[],
    data: { indexes: number[]; column: { key: string } },
  ) => {
    if (!editable) return
    const wb = workbookRef.current
    if (!wb) return
    const ci = Number(data.column.key)
    if (Number.isNaN(ci)) return
    const sheetIdx = activeIdx
    const sheet = wb.sheets[sheetIdx]
    if (!sheet) return

    for (const ri of data.indexes) {
      const newCells = newRows[ri]?.cells
      if (!newCells) continue
      const newValueStr = newCells[ci]?.value ?? ''
      const { value, type } = coerceUserInput(newValueStr)

      // Update workbook: dense rows table (used by hucre's writers) + cells
      // map (preserves style etc.). Clearing formula matches Excel's "user
      // typed a literal over a formula" behavior.
      while (sheet.rows.length <= ri) sheet.rows.push([])
      const wbRow = sheet.rows[ri]
      while (wbRow.length <= ci) wbRow.push(null)
      wbRow[ci] = value

      if (!sheet.cells) sheet.cells = new Map()
      const key = `${ri},${ci}`
      const existing = sheet.cells.get(key)
      sheet.cells.set(key, {
        ...(existing ?? {}),
        value,
        type,
        formula: undefined,
        formulaResult: undefined,
      })
    }

    // Update local display state so the grid reflects the edit immediately.
    setSheets((prev) => {
      if (!prev) return prev
      return prev.map((s, i) => (i === sheetIdx ? { ...s, rows: newRows.map((r) => r.cells) } : s))
    })

    // Debounce serialization — each saveXlsx call rezips the workbook, so we
    // coalesce bursts of edits (e.g. arrow-key navigation through cells).
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        const { saveXlsx } = await loadXlsxModule()
        const bytes = await saveXlsx(wb)
        onBytesChange?.(bytes)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }, SAVE_DEBOUNCE_MS)
  }

  if (error) {
    return (
      <div className="flex-1 p-3">
        <Alert variant="destructive">
          <AlertDescription>{t('components.xlsxPreview.parseError', { error })}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!sheets) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (sheets.length === 0 || !active) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('components.xlsxPreview.empty')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <DataGrid
          columns={columns}
          rows={gridRows}
          onRowsChange={editable ? handleRowsChange : undefined}
          rowHeight={(row: GridRow) => active.rowHeights[row.__rowIdx] ?? DEFAULT_ROW_PX}
          headerRowHeight={HEADER_ROW_PX}
          className="rdg-light h-full"
          style={{ blockSize: '100%' }}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-border/50 border-t bg-muted/30 px-2 py-1">
        {sheets.map((s, i) => (
          <button
            type="button"
            key={`${s.name}-${i}`}
            onClick={() => setActiveIdx(i)}
            className={cn(
              'h-6 shrink-0 rounded px-2 text-xs',
              i === activeIdx
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60',
            )}
          >
            {s.name}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center">
          {onOpenOfficeMode && (
            <button
              type="button"
              onClick={onOpenOfficeMode}
              className="h-6 rounded px-2 text-xs text-muted-foreground hover:bg-background/60"
            >
              {t('components.xlsxPreview.openOfficeMode')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
