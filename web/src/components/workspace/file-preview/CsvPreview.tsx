import { ScrollBar } from '@/components/ui/scroll-area'
import { colLabel } from '@/lib/spreadsheet'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import Papa from 'papaparse'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export function CsvPreview({ content, filename }: { content: string; filename: string }) {
  const { t } = useTranslation()
  const { rows, columnCount } = useMemo(() => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const result = Papa.parse<string[]>(content, {
      delimiter: ext === 'tsv' ? '\t' : undefined,
      skipEmptyLines: true,
    })
    const data = result.data
    // Ragged CSVs are common; size the grid to the widest row so no cell is
    // silently dropped.
    let columnCount = 0
    for (const row of data) if (row.length > columnCount) columnCount = row.length
    return { rows: data, columnCount }
  }, [content, filename])

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('components.csvPreview.empty')}
      </div>
    )
  }

  return (
    <ScrollAreaPrimitive.Root className="relative flex-1 overflow-hidden">
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] [&>div]:!block">
        <div className="p-2">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-muted border border-border" />
                {Array.from({ length: columnCount }, (_, ci) => (
                  <th
                    key={colLabel(ci)}
                    className="sticky top-0 z-10 bg-muted px-2 py-1 text-center font-mono text-[11px] font-medium text-muted-foreground border border-border whitespace-nowrap"
                  >
                    {colLabel(ci)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-muted/50">
                  <td className="sticky left-0 z-10 bg-muted px-2 py-1 text-center font-mono text-[11px] text-muted-foreground/80 border border-border">
                    {ri + 1}
                  </td>
                  {Array.from({ length: columnCount }, (_, ci) => (
                    <td key={ci} className="px-2 py-1 border border-border/50 whitespace-nowrap">
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-mini text-muted-foreground">
            {t('components.csvPreview.summary', { rows: rows.length, columns: columnCount })}
          </div>
        </div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
