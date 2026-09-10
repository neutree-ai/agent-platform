import * as jobs from '../lib/jobs'
import { createSchedule, updateSchedule } from './db/schedules'

/**
 * Fixed prompt for a Reflect turn. The agent has the target store mounted at
 * /mnt/memory/<store_id>/ and, for this turn only, the `list_recent_activity`
 * / `get_activity_digest` MCP tools (see mcp/tools/reflect.ts) instead of the
 * workspace's normal toolset.
 */
const REFLECT_PROMPT = `现在是一次记忆巩固（Reflect）。目标 store 已挂载在 /mnt/memory/<store_id>/。

1. 用 \`list_recent_activity\` 查看自上次巩固以来的活动，挑出看起来和这份记忆相关的 session。
2. 用 \`get_activity_digest\` 精读挑出的 session。
3. 对照当前 memory 文件，只在下列情况下修改：
   - Merge：新信息完全包含某条旧记忆时才合并，模糊不动
   - Supersede：有证据明确替换同一事实时才替换（旧内容会保留在版本历史里，不必手动保留）
   - Synthesize：多条独立观察共同支持同一结论时才提炼成新的高层记忆；单次提及不构成充分证据
   - 证据不足时，什么都不做，好过猜测
4. 只能依据 list_recent_activity / get_activity_digest 返回的内容和当前 memory 文件判断，不要编造未出现的事实。
5. 需要的话更新 MEMORY.md 索引，保持和实际文件一致。
6. 完成后用一两句话总结这次改了什么、为什么。`

/** Default cadence for an auto-created Reflect schedule: weekly. */
const DEFAULT_REFLECT_CRON = '0 3 * * 0'

/**
 * Create the builtin Reflect schedule for a workspace's own memory store.
 * Mirrors `materializeOne` in template-schedules.ts: on pg-boss registration
 * failure, leave the row but flip it disabled rather than claim it's active.
 * Never throws — a Reflect bootstrap failure should not fail workspace
 * creation, matching the caller's existing try/catch around the store
 * auto-provision this sits next to.
 */
export async function createReflectSchedule(args: {
  workspaceId: string
  userId: string
  storeId: string
}): Promise<void> {
  const schedule = await createSchedule({
    workspace_id: args.workspaceId,
    user_id: args.userId,
    name: 'Memory Reflect',
    cron: DEFAULT_REFLECT_CRON,
    run_at: null,
    timezone: 'UTC',
    prompt: REFLECT_PROMPT,
    prompt_id: null,
    origin: 'local',
    enabled: true,
    reflect_store_id: args.storeId,
  })
  try {
    const pgbossJobId = await jobs.enqueueScheduleTimer(schedule)
    if (pgbossJobId) await updateSchedule(schedule.id, { pgboss_job_id: pgbossJobId })
  } catch {
    await updateSchedule(schedule.id, { enabled: false, pgboss_job_id: null })
  }
}
