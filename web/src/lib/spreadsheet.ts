/** Column letter for spreadsheet-style headers (A, B, ..., Z, AA, AB, ...). */
export function colLabel(idx: number): string {
  let n = idx + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
