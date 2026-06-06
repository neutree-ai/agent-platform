import { ScrollBar } from '@/components/ui/scroll-area'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import Papa from 'papaparse'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export function CsvPreview({ content, filename }: { content: string; filename: string }) {
  const { t } = useTranslation()
  const { headers, rows } = useMemo(() => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const result = Papa.parse<string[]>(content, {
      delimiter: ext === 'tsv' ? '\t' : undefined,
      skipEmptyLines: true,
    })
    const data = result.data
    if (data.length === 0) return { headers: [], rows: [] }
    return { headers: data[0], rows: data.slice(1) }
  }, [content, filename])

  if (headers.length === 0) {
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
                {headers.map((h, i) => (
                  <th
                    key={i}
                    className="sticky top-0 bg-muted px-2 py-1.5 text-left font-medium text-muted-foreground border border-border whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-muted/50">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-2 py-1 border border-border/50 whitespace-nowrap">
                      {row[ci] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-mini text-muted-foreground">
            {t('components.csvPreview.summary', { rows: rows.length, columns: headers.length })}
          </div>
        </div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
