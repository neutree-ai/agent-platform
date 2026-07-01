import { pool } from './pool'

export interface SystemSettings {
  asr_active_provider: string | null
  asr_providers: Record<string, unknown>
  titlegen_active_provider: string | null
  titlegen_providers: Record<string, unknown>
}

export async function getSettings(): Promise<SystemSettings> {
  const { rows } = await pool.query(
    `SELECT asr_active_provider, asr_providers, titlegen_active_provider, titlegen_providers
     FROM system_settings WHERE id = 1`,
  )
  const row = rows[0] ?? {}
  return {
    asr_active_provider: row.asr_active_provider ?? null,
    asr_providers: row.asr_providers ?? {},
    titlegen_active_provider: row.titlegen_active_provider ?? null,
    titlegen_providers: row.titlegen_providers ?? {},
  }
}

export async function updateSettings(
  patch: Partial<SystemSettings>,
  userId: string,
): Promise<SystemSettings> {
  const sets: string[] = []
  const values: unknown[] = []

  if ('asr_active_provider' in patch) {
    values.push(patch.asr_active_provider)
    sets.push(`asr_active_provider = $${values.length}`)
  }

  if ('asr_providers' in patch) {
    values.push(patch.asr_providers)
    sets.push(`asr_providers = $${values.length}`)
  }

  if ('titlegen_active_provider' in patch) {
    values.push(patch.titlegen_active_provider)
    sets.push(`titlegen_active_provider = $${values.length}`)
  }

  if ('titlegen_providers' in patch) {
    values.push(patch.titlegen_providers)
    sets.push(`titlegen_providers = $${values.length}`)
  }

  if (sets.length === 0) return getSettings()

  values.push(userId)
  sets.push(`updated_by = $${values.length}`)
  sets.push('updated_at = now()')

  await pool.query(`UPDATE system_settings SET ${sets.join(', ')} WHERE id = 1`, values)
  return getSettings()
}
