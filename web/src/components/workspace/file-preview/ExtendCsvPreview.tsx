// Renders CSV/TSV with Extend UI's CsvViewer. The viewer takes the raw text via
// `data` and parses it itself (papaparse) into a virtualized Glide grid.
import { CsvViewer } from './extend/csv-viewer'

export function ExtendCsvPreview({ content }: { content: string; filename: string }) {
  return <CsvViewer data={content} className="min-h-0 flex-1" />
}
