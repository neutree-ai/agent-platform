"use client"

/**
 * Vendored from Extend UI — https://github.com/extend-hq/ui
 * Copyright (c) Extend (https://www.extend.ai) · MIT License
 *
 * Brought in via the shadcn "copy" model and adapted for this app (imports
 * repointed to vendored primitives; embedded toolbar file/theme controls
 * trimmed in favor of our own; edit save-back bridged to our pipeline via the
 * controller's revision counter). Thanks to the Extend UI authors.
 */

import * as React from "react"
import {
  useXlsxViewer,
  useXlsxViewerController,
  useXlsxViewerEditing,
  useXlsxViewerSelection,
  useXlsxViewerZoom,
  XlsxViewer,
  XlsxViewerProvider,
  type XlsxTableHeaderMenuRenderProps,
} from "@extend-ai/react-xlsx"
import {
  CircleMinus,
  CirclePlus,
  Moon,
  Plus,
  Redo2,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "./ui/button"
import { Group, GroupSeparator, GroupText } from "./ui/group"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  renderXlsxScroller,
  useControllableDarkMode,
  WorkbookSheetTabs,
  WorkbookTableHeaderMenu,
} from "./xlsx-viewer"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const XLSX_LOADING_INDICATOR_DELAY_MS = 300
const XLSX_EDITOR_READ_ONLY_THRESHOLD_BYTES = 5 * 1024 * 1024
const XLSX_DROPDOWN_Z_INDEX_CLASS = "z-40"
const ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200, 400] as const
const XLSX_EDITOR_SELECT_CHROME_CLASS =
  "shadow-none before:shadow-none not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-none dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-none"
const XLSX_EDITOR_FORMULA_INPUT_CHROME_CLASS =
  "has-disabled:opacity-100 dark:has-disabled:before:shadow-[0_-1px_--theme(--color-white/6%)]"

type UploadedWorkbook = {
  buffer: ArrayBuffer
  fileName: string
  identity: string
}

function formatWorkbookName(fileName: string | undefined, url: string) {
  if (fileName?.trim()) return fileName

  const pathname = url.split("?")[0] ?? ""
  const rawName = pathname.split("/").pop() ?? "workbook.xlsx"

  try {
    return decodeURIComponent(rawName)
  } catch {
    return rawName
  }
}

function useDelayedLoadingIndicator(isLoading: boolean, delayMs: number) {
  const [showSpinner, setShowSpinner] = React.useState(false)

  React.useEffect(() => {
    if (!isLoading) {
      setShowSpinner(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setShowSpinner(true)
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [delayMs, isLoading])

  return showSpinner
}

function ToolbarTooltip({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function EditorLoadingSurface({
  showSpinner = true,
}: {
  showSpinner?: boolean
}) {
  return (
    <div className="grid h-full min-h-52 w-full min-w-full place-items-center bg-transparent">
      {showSpinner ? <Spinner className="size-4" /> : null}
    </div>
  )
}

function EditorToolbar({
  isDark,
  onIsDarkChange,
  showNightRenderToggle,
}: {
  isDark: boolean
  onIsDarkChange: (checked: boolean) => void
  showNightRenderToggle: boolean
}) {
  const {
    activeSheet,
    activeSheetIndex,
    setActiveSheetIndex,
    sheets,
  } = useXlsxViewer()
  const { activeCell, activeCellAddress, selection } = useXlsxViewerSelection()
  const {
    addSheet,
    canRedo,
    canUndo,
    mergeSelection,
    readOnly,
    redo,
    removeActiveSheet,
    selectedFormula,
    selectedValue,
    setCellFormula,
    setCellValue,
    undo,
    unmergeSelection,
  } = useXlsxViewerEditing()
  const { canZoomIn, canZoomOut, setZoomScale, zoomIn, zoomOut, zoomScale } =
    useXlsxViewerZoom()
  const [formulaDraft, setFormulaDraft] = React.useState("")
  const [formulaFocused, setFormulaFocused] = React.useState(false)
  const formulaEditCellRef = React.useRef<typeof activeCell>(null)
  const formulaInitialValueRef = React.useRef("")
  const hasWorkbook = sheets.length > 0
  const hasSelection = Boolean(selection)
  const hasActiveCell = Boolean(activeCell)
  const currentZoom = Math.round(zoomScale)
  const selectedCellInputValue = selectedFormula || selectedValue

  React.useEffect(() => {
    if (formulaFocused) return
    setFormulaDraft(selectedCellInputValue)
  }, [formulaFocused, selectedCellInputValue, activeCellAddress])

  const commitFormula = React.useCallback(() => {
    const targetCell = formulaEditCellRef.current ?? activeCell
    if (!targetCell) return
    if (formulaDraft === formulaInitialValueRef.current) return

    if (formulaDraft.trim().startsWith("=")) {
      setCellFormula(targetCell, formulaDraft)
    } else {
      setCellValue(targetCell, formulaDraft)
    }
    formulaInitialValueRef.current = formulaDraft
  }, [activeCell, formulaDraft, setCellFormula, setCellValue])

  return (
    <div className="border-b bg-background">
      <div className="flex min-h-11 items-center justify-between gap-3 border-b px-3">
        <div className="min-w-0 flex-1" />
        <TooltipProvider>
          <div className="flex shrink-0 items-center gap-1">
            {showNightRenderToggle ? (
              <>
                <ToolbarTooltip
                  label={isDark ? "Use light workbook" : "Use dark workbook"}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      isDark ? "Use light workbook" : "Use dark workbook"
                    }
                    onClick={() => onIsDarkChange(!isDark)}
                  >
                    {isDark ? (
                      <Sun className="size-4" />
                    ) : (
                      <Moon className="size-4" />
                    )}
                  </Button>
                </ToolbarTooltip>
                <Separator
                  orientation="vertical"
                  className="mx-1 h-4 self-center"
                />
              </>
            ) : null}
            {/* Export/download + upload-replace removed — file in/out is
                controlled by our app, not the embedded toolbar. */}
          </div>
        </TooltipProvider>
      </div>
      <TooltipProvider>
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
          <div className="flex shrink-0 items-center gap-1">
            <ToolbarTooltip label="Undo">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Undo"
                disabled={!canUndo || readOnly}
                onClick={undo}
              >
                <Undo2 className="size-4" />
              </Button>
            </ToolbarTooltip>
            <ToolbarTooltip label="Redo">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Redo"
                disabled={!canRedo || readOnly}
                onClick={redo}
              >
                <Redo2 className="size-4" />
              </Button>
            </ToolbarTooltip>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasSelection || readOnly}
              onClick={mergeSelection}
            >
              Merge
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasSelection || readOnly}
              onClick={unmergeSelection}
            >
              Unmerge
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ToolbarTooltip label="Add sheet">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Add sheet"
                disabled={!hasWorkbook || readOnly}
                onClick={() => addSheet()}
              >
                <Plus className="size-4" />
              </Button>
            </ToolbarTooltip>
            <ToolbarTooltip label="Remove active sheet">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove active sheet"
                disabled={sheets.length <= 1 || readOnly}
                onClick={removeActiveSheet}
              >
                <Trash2 className="size-4" />
              </Button>
            </ToolbarTooltip>
            <Select
              value={String(activeSheetIndex)}
              onValueChange={(value) => setActiveSheetIndex(Number(value))}
              disabled={!hasWorkbook}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "w-[150px] min-w-[150px]",
                  XLSX_EDITOR_SELECT_CHROME_CLASS
                )}
                aria-label="Active sheet"
              >
                <SelectValue>{activeSheet?.name ?? "Sheet"}</SelectValue>
              </SelectTrigger>
              <SelectContent
                align="start"
                className={XLSX_DROPDOWN_Z_INDEX_CLASS}
              >
                {sheets.map((sheet, index) => (
                  <SelectItem
                    key={`${sheet.name}-${index}`}
                    value={String(index)}
                  >
                    {sheet.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-none items-center gap-1">
            <ToolbarTooltip label="Zoom out">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!hasWorkbook || !canZoomOut}
                aria-label="Zoom out"
                onClick={zoomOut}
              >
                <CircleMinus className="size-4" />
              </Button>
            </ToolbarTooltip>
            <Select
              value={currentZoom.toString()}
              onValueChange={(value) => setZoomScale(Number(value))}
              disabled={!hasWorkbook}
              modal={false}
            >
              <SelectTrigger
                size="sm"
                className={cn(
                  "w-[84px] min-w-[84px]",
                  XLSX_EDITOR_SELECT_CHROME_CLASS
                )}
                aria-label="Zoom level"
              >
                <SelectValue>{currentZoom}%</SelectValue>
              </SelectTrigger>
              <SelectContent
                align="end"
                alignItemWithTrigger={false}
                className={XLSX_DROPDOWN_Z_INDEX_CLASS}
              >
                {ZOOM_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value.toString()}>
                    {value}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ToolbarTooltip label="Zoom in">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={!hasWorkbook || !canZoomIn}
                aria-label="Zoom in"
                onClick={zoomIn}
              >
                <CirclePlus className="size-4" />
              </Button>
            </ToolbarTooltip>
          </div>
        </div>
        <div className="border-t bg-background px-2 py-1">
          <Group className="w-full">
            <Input
              className={cn(
                "h-8 w-[92px] shrink-0 font-mono text-xs",
                XLSX_EDITOR_FORMULA_INPUT_CHROME_CLASS
              )}
              readOnly
              value={activeCellAddress ?? ""}
            />
            <GroupSeparator />
            <GroupText className="h-8 w-9 shrink-0 justify-center px-0 text-[11px] font-semibold italic">
              fx
            </GroupText>
            <GroupSeparator />
            <Input
              className={cn(
                "h-8 flex-1",
                XLSX_EDITOR_FORMULA_INPUT_CHROME_CLASS
              )}
              disabled={!hasActiveCell || readOnly}
              value={formulaDraft}
              onBlur={() => {
                commitFormula()
                setFormulaFocused(false)
              }}
              onChange={(event) => setFormulaDraft(event.target.value)}
              onFocus={() => {
                formulaEditCellRef.current = activeCell
                formulaInitialValueRef.current = formulaDraft
                setFormulaFocused(true)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  commitFormula()
                  setFormulaFocused(false)
                }
              }}
              placeholder="Select a cell, then enter a value or formula"
            />
          </Group>
        </div>
      </TooltipProvider>
    </div>
  )
}

export function XlsxEditorSurface({
  className,
  isDark,
  onIsDarkChange,
  renderTableHeaderMenu,
  rounded,
  showNightRenderToggle,
  workbookIdentity,
}: {
  className?: string
  isDark: boolean
  onIsDarkChange: (checked: boolean) => void
  renderTableHeaderMenu: (
    props: XlsxTableHeaderMenuRenderProps
  ) => React.ReactNode
  rounded: boolean
  showNightRenderToggle: boolean
  workbookIdentity: string
}) {
  const { error } = useXlsxViewer()

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        className,
        rounded && "rounded-lg"
      )}
    >
      <EditorToolbar
        isDark={isDark}
        onIsDarkChange={onIsDarkChange}
        showNightRenderToggle={showNightRenderToggle}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 bg-muted/20">
          <XlsxViewer
            experimentalCanvas
            allowResizeInReadOnly
            className="h-full min-h-0 min-w-0"
            height="100%"
            isDark={isDark}
            readOnly={false}
            rounded={false}
            showDefaultToolbar={false}
            showImages
            fileTooLargeState={
              <div className="grid h-full w-full min-w-full place-items-center p-6">
                <div className="max-w-sm rounded-lg border bg-background p-4 text-sm">
                  <p className="font-medium">File too large for editing</p>
                  <p className="mt-1 text-muted-foreground">
                    This workbook exceeds the editor limit. Download it or open
                    a smaller file to make changes.
                  </p>
                </div>
              </div>
            }
            loadingState={<EditorLoadingSurface />}
            renderScroller={renderXlsxScroller}
            errorState={
              <div className="grid h-full w-full min-w-full place-items-center p-6 text-sm text-destructive">
                {error?.message ?? "Unable to edit workbook."}
              </div>
            }
            renderTableHeaderMenu={renderTableHeaderMenu}
          />
        </div>
        <WorkbookSheetTabs workbookIdentity={workbookIdentity} />
      </div>
    </div>
  )
}

export function XlsxEditorPreview({
  className,
  defaultIsDark = false,
  fileName,
  isDark: controlledIsDark,
  onBytesChange,
  onIsDarkChange,
  rounded = false,
  src,
}: {
  className?: string
  defaultIsDark?: boolean
  fileName?: string
  isDark?: boolean
  onBytesChange?: (bytes: Uint8Array) => void
  onIsDarkChange?: (isDark: boolean) => void
  rounded?: boolean
  src?: string
}) {
  const [effectiveIsDark, setIsDark] = useControllableDarkMode({
    defaultIsDark,
    isDark: controlledIsDark,
    onIsDarkChange,
  })

  return (
    <XlsxEditorContent
      className={className}
      effectiveIsDark={effectiveIsDark}
      fileName={fileName}
      onBytesChange={onBytesChange}
      rounded={rounded}
      setNightRenderEnabled={setIsDark}
      shouldRenderNightMode={false}
      url={src}
    />
  )
}

function XlsxEditorContent({
  className,
  effectiveIsDark,
  fileName,
  onBytesChange,
  rounded,
  setNightRenderEnabled,
  shouldRenderNightMode,
  url,
}: {
  className?: string
  effectiveIsDark: boolean
  fileName?: string
  onBytesChange?: (bytes: Uint8Array) => void
  rounded: boolean
  setNightRenderEnabled: (checked: boolean) => void
  shouldRenderNightMode: boolean
  url?: string
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploadedWorkbook, setUploadedWorkbook] =
    React.useState<UploadedWorkbook | null>(null)
  const [workbookBuffer, setWorkbookBuffer] =
    React.useState<ArrayBuffer | null>(null)
  const [loadError, setLoadError] = React.useState<string>()
  const sourceFileName = React.useMemo(
    () =>
      url ? formatWorkbookName(fileName, url) : (fileName ?? "workbook.xlsx"),
    [fileName, url]
  )
  const displayFileName = uploadedWorkbook?.fileName ?? sourceFileName
  const workbookIdentity =
    uploadedWorkbook?.identity ?? `${url ?? "empty"}::${displayFileName}`
  const shouldShowLoadingSpinner = useDelayedLoadingIndicator(
    !workbookBuffer && !loadError && !uploadedWorkbook,
    XLSX_LOADING_INDICATOR_DELAY_MS
  )

  React.useEffect(() => {
    let isCurrent = true

    if (url) {
      setUploadedWorkbook(null)
    }

    async function loadWorkbook(): Promise<void> {
      if (!url) {
        setWorkbookBuffer(null)
        setLoadError(undefined)
        return
      }

      setWorkbookBuffer(null)
      setLoadError(undefined)

      try {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to fetch XLSX (${response.status})`)
        }

        const nextWorkbookBuffer = await response.arrayBuffer()
        if (!isCurrent) return

        setWorkbookBuffer(nextWorkbookBuffer)
      } catch (error) {
        if (!isCurrent) return

        setLoadError(
          error instanceof Error ? error.message : "Unknown XLSX load error"
        )
      }
    }

    void loadWorkbook()

    return () => {
      isCurrent = false
    }
  }, [url])

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) return

    const buffer = await file.arrayBuffer()
    setWorkbookBuffer(null)
    setLoadError(undefined)
    setUploadedWorkbook({
      buffer,
      fileName: file.name,
      identity: `${file.name}-${file.size}-${file.lastModified}`,
    })
  }

  const activeBuffer = uploadedWorkbook?.buffer ?? workbookBuffer

  if (!url && !uploadedWorkbook) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-background",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <div className="grid min-h-0 flex-1 place-items-center bg-muted/30 p-4">
          <div className="max-w-md rounded-lg border bg-background p-4 text-center text-sm shadow-xs">
            <p className="font-medium">Upload a workbook to edit</p>
            <p className="mt-1 text-muted-foreground">
              Pass an XLSX URL with the <code>src</code> prop or upload a local
              file.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              Upload XLSX
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (loadError && !activeBuffer) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-background",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <div className="grid min-h-0 flex-1 place-items-center bg-muted/30 p-4">
          <div className="max-w-md rounded-lg border bg-background p-4 text-sm">
            <p className="font-medium">Unable to edit workbook</p>
            <p className="mt-1 text-muted-foreground">{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              Upload XLSX
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!activeBuffer) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-background",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleUpload}
        />
        <EditorLoadingSurface showSpinner={shouldShowLoadingSpinner} />
      </div>
    )
  }

  return (
    <div className={cn("overflow-hidden", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={handleUpload}
      />
      <XlsxWorkbookLoadedEditor
        fileName={displayFileName}
        isDark={effectiveIsDark}
        onBytesChange={onBytesChange}
        onIsDarkChange={setNightRenderEnabled}
        renderTableHeaderMenu={(props) => (
          <WorkbookTableHeaderMenu {...props} />
        )}
        rounded={rounded}
        showNightRenderToggle={shouldRenderNightMode}
        workbookBuffer={activeBuffer}
        workbookIdentity={workbookIdentity}
      />
    </div>
  )
}

function XlsxWorkbookLoadedEditor({
  fileName,
  isDark,
  onBytesChange,
  onIsDarkChange,
  renderTableHeaderMenu,
  rounded,
  showNightRenderToggle,
  workbookBuffer,
  workbookIdentity,
}: {
  fileName: string
  isDark: boolean
  onBytesChange?: (bytes: Uint8Array) => void
  onIsDarkChange: (checked: boolean) => void
  renderTableHeaderMenu: (
    props: XlsxTableHeaderMenuRenderProps
  ) => React.ReactNode
  rounded: boolean
  showNightRenderToggle: boolean
  workbookBuffer: ArrayBuffer
  workbookIdentity: string
}) {
  const controller = useXlsxViewerController(
    React.useMemo(
      () => ({
        allowResizeInReadOnly: true,
        file: workbookBuffer,
        fileName,
        readOnly: false,
        readOnlyAboveBytes: XLSX_EDITOR_READ_ONLY_THRESHOLD_BYTES,
        useWorker: true,
      }),
      [fileName, workbookBuffer]
    )
  )

  // Bridge edits back to the host (our workspace save pipeline). @extend-ai/
  // react-xlsx exposes no onChange/serialize callback, but the controller does
  // expose `workbook` + a `revision` counter that bumps on every mutation. We
  // watch revision, debounce, and serialize via the wasm workbook's
  // saveXlsxBytes(). Note: this is the raw workbook serialization — it does not
  // re-merge in-session image asset edits the way the built-in download path
  // does, so cell/formula/style edits round-trip but newly added images may not.
  const onBytesChangeRef = React.useRef(onBytesChange)
  onBytesChangeRef.current = onBytesChange
  const baselineRevisionRef = React.useRef<number | null>(null)
  const lastWorkbookRef = React.useRef(controller.workbook)
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    },
    []
  )

  React.useEffect(() => {
    const workbook = controller.workbook
    if (!workbook) return
    // Reset the baseline whenever a different workbook loads so a fresh file's
    // initial revision isn't mistaken for an edit.
    if (lastWorkbookRef.current !== workbook) {
      lastWorkbookRef.current = workbook
      baselineRevisionRef.current = controller.revision
      return
    }
    if (baselineRevisionRef.current === null) {
      baselineRevisionRef.current = controller.revision
      return
    }
    if (controller.revision === baselineRevisionRef.current) return
    if (!onBytesChangeRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      try {
        onBytesChangeRef.current?.(workbook.saveXlsxBytes())
      } catch {
        // Serialization can throw mid-edit (e.g. wasm busy); the next revision
        // bump will retry, so swallow rather than surface a transient error.
      }
    }, 300)
  }, [controller.revision, controller.workbook])

  return (
    <XlsxViewerProvider controller={controller} isDark={isDark}>
      <XlsxEditorSurface
        isDark={isDark}
        onIsDarkChange={onIsDarkChange}
        renderTableHeaderMenu={renderTableHeaderMenu}
        rounded={rounded}
        showNightRenderToggle={showNightRenderToggle}
        workbookIdentity={workbookIdentity}
      />
    </XlsxViewerProvider>
  )
}
