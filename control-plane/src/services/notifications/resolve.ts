export interface PreferenceRow {
  event_type: string
  channel: string
  scope: string
  enabled: boolean
}

/**
 * Pure function: given all preference rows for a user, resolve which channels
 * should receive a notification for the given event type and scope.
 *
 * Specificity order (highest to lowest):
 *   1. exact event_type + exact scope
 *   2. exact event_type + scope='*'
 *   3. event_type='*' + exact scope
 *   4. event_type='*' + scope='*'
 *
 * Each channel is resolved independently — the most specific matching row wins.
 * If no rows match at all, returns [].
 */
export function resolveChannels(rows: PreferenceRow[], eventType: string, scope: string): string[] {
  if (rows.length === 0) return []

  // Group rows by channel, pick the most specific row per channel
  const bestPerChannel = new Map<string, { specificity: number; enabled: boolean }>()

  for (const row of rows) {
    const eventMatch = row.event_type === eventType
    const eventWild = row.event_type === '*'
    const scopeMatch = row.scope === scope
    const scopeWild = row.scope === '*'

    // Skip rows that don't match the query at all
    if (!eventMatch && !eventWild) continue
    if (!scopeMatch && !scopeWild) continue

    // Higher specificity = higher priority
    const specificity = (eventMatch ? 2 : 0) + (scopeMatch ? 1 : 0)

    const existing = bestPerChannel.get(row.channel)
    if (!existing || specificity > existing.specificity) {
      bestPerChannel.set(row.channel, { specificity, enabled: row.enabled })
    }
  }

  const channels: string[] = []
  for (const [channel, { enabled }] of bestPerChannel) {
    if (enabled) channels.push(channel)
  }
  return channels
}
