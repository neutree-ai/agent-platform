/** Abbreviate large counts (1234567 → 1.2M) to keep numeric columns narrow. */
export function formatCompact(n: number): string {
  if (n < 1000) return n.toLocaleString()
  const units = ['K', 'M', 'B', 'T']
  let u = -1
  let v = n
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)}${units[u]}`
}
