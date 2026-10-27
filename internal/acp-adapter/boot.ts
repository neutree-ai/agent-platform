export interface LoadConfigAtBootOptions {
  /** CP_URL and WORKSPACE_ID are both set; without them there is nothing to retry. */
  cpConfigured: boolean
  workspaceId?: string
  maxAttempts?: number
  retryDelayMs?: number
  exit?: (code: number) => never
}

/**
 * Load the workspace config from cp at boot. cp can be briefly unreachable
 * while the pod boots (cp restarting, a node coming back before its service
 * routing is ready). Without the config the provider key never reaches the
 * agent and every turn fails, so retry, and if cp stays away exit for a
 * kubelet restart rather than serve a workspace that cannot run.
 */
export async function loadConfigAtBoot(
  loadConfig: () => Promise<boolean>,
  {
    cpConfigured,
    workspaceId,
    maxAttempts = 5,
    retryDelayMs = 3000,
    exit = process.exit,
  }: LoadConfigAtBootOptions,
): Promise<void> {
  if (!cpConfigured) {
    await loadConfig()
    return
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (await loadConfig()) {
        console.log('[agent] Config loaded from CP')
        return
      }
    } catch (e) {
      console.error('[agent] Failed to fetch config from CP:', e)
    }
    if (attempt < maxAttempts) {
      console.warn(
        `[agent] Config load attempt ${attempt}/${maxAttempts} failed, retrying in ${retryDelayMs}ms...`,
      )
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }
  console.error(
    `[agent] BOOT_FAILED workspace=${workspaceId} config load failed after ${maxAttempts} attempts — exiting for kubelet restart`,
  )
  exit(1)
}
