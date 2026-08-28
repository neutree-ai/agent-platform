import { pool } from './pool'

export interface SystemSettings {
  asr_active_provider: string | null
  asr_providers: Record<string, unknown>
  titlegen_active_provider: string | null
  titlegen_providers: Record<string, unknown>
  branding_short_name: string | null
  branding_full_name: string | null
  branding_logo_data: string | null
  branding_logo_mime: string | null
}

export async function getSettings(): Promise<SystemSettings> {
  const { rows } = await pool.query(
    `SELECT asr_active_provider, asr_providers, titlegen_active_provider, titlegen_providers,
            branding_short_name, branding_full_name, branding_logo_data, branding_logo_mime
     FROM system_settings WHERE id = 1`,
  )
  const row = rows[0] ?? {}
  return {
    asr_active_provider: row.asr_active_provider ?? null,
    asr_providers: row.asr_providers ?? {},
    titlegen_active_provider: row.titlegen_active_provider ?? null,
    titlegen_providers: row.titlegen_providers ?? {},
    branding_short_name: row.branding_short_name ?? null,
    branding_full_name: row.branding_full_name ?? null,
    branding_logo_data: row.branding_logo_data ?? null,
    branding_logo_mime: row.branding_logo_mime ?? null,
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

  if ('branding_short_name' in patch) {
    values.push(patch.branding_short_name)
    sets.push(`branding_short_name = $${values.length}`)
  }

  if ('branding_full_name' in patch) {
    values.push(patch.branding_full_name)
    sets.push(`branding_full_name = $${values.length}`)
  }

  if ('branding_logo_data' in patch) {
    values.push(patch.branding_logo_data)
    sets.push(`branding_logo_data = $${values.length}`)
  }

  if ('branding_logo_mime' in patch) {
    values.push(patch.branding_logo_mime)
    sets.push(`branding_logo_mime = $${values.length}`)
  }

  if (sets.length === 0) return getSettings()

  values.push(userId)
  sets.push(`updated_by = $${values.length}`)
  sets.push('updated_at = now()')

  await pool.query(`UPDATE system_settings SET ${sets.join(', ')} WHERE id = 1`, values)
  return getSettings()
}
