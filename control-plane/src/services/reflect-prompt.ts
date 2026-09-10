/**
 * Prompt for a Reflect turn (see reflect.ts). Kept in its own module,
 * separate from the scheduling logic that uses it, so it reads and diffs
 * like prose rather than being buried in a string literal.
 *
 * Parameterized by storeId rather than a fixed constant: a schedule's target
 * store is baked into the stored prompt text at create/reconcile time
 * (memory_stores.reflect_schedule_id is 1:1 with a store), so the agent
 * never has to guess or discover its own mount path. For this turn only,
 * the agent also has the `list_recent_activity` / `get_activity_digest` MCP
 * tools (see mcp/tools/reflect.ts) instead of the workspace's normal
 * toolset.
 */
export function buildReflectPrompt(storeId: string): string {
  return `This is a memory consolidation ("Reflect") pass. The target store is mounted at /mnt/memory/${storeId}/.

1. Call \`list_recent_activity\` to see what happened in this pass's window. Pick out sessions that look relevant to this memory. The window is bounded — on a store with a lot of backlog, it may not reach all the way to now, and that's fine; the next scheduled run picks up exactly where this one stops.
2. Call \`get_activity_digest\` to read the sessions you picked in full.
3. Compare against the current memory files. Only make a change when one of these applies:
   - Merge: a new fact fully subsumes an existing memory — combine them.
   - Supersede: there is clear evidence that replaces an existing fact (the old content stays recoverable in version history, no need to preserve it by hand).
   - Synthesize: several independent observations support the same conclusion — distill them into a new higher-level memory. A single mention is not enough evidence on its own.
   - When the evidence is ambiguous, do nothing. Doing nothing is better than guessing.
4. Base every decision only on what \`list_recent_activity\` / \`get_activity_digest\` returned and the current memory files — never invent facts that didn't appear there.
5. Update MEMORY.md if needed so the index stays in sync with the actual files.
6. When done, summarize in one or two sentences what changed and why.`
}
