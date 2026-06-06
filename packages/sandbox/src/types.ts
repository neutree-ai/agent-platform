// ---- Sandbox lifecycle ----

export interface SandboxInfo {
  id: string
  status: { state: string; reason?: string; message?: string }
  image?: { uri: string }
  metadata?: Record<string, string>
  expiresAt?: string
  createdAt?: string
}

export interface CreateOptions {
  image: string
  resource?: { cpu?: string; memory?: string }
  timeoutSeconds?: number
  entrypoint?: string[]
  env?: Record<string, string>
  metadata?: Record<string, string>
}

export interface ListFilter {
  metadata?: Record<string, string>
}

// ---- Command execution ----

export interface ExecOptions {
  cwd?: string
  timeoutSeconds?: number
  env?: Record<string, string>
}

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  executionTimeMs?: number
}

// ---- Files ----

export interface WriteFileEntry {
  path: string
  content: string
}
