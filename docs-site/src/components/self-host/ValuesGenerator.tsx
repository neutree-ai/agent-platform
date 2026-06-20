import { useMemo, useState } from 'preact/hooks'
import './values-generator.css'

// ---------------------------------------------------------------------------
// Schema — field definitions for values.env. Single source of truth: drives
// form rendering, validation, and output.
// ---------------------------------------------------------------------------

type FieldKind =
  | 'text'
  | 'password'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'select'

interface FieldDef {
  key: string
  kind: FieldKind
  label: string
  hint?: string
  placeholder?: string
  default?: string
  required?: boolean
  /** select only */
  options?: string[]
  validate?: (
    value: string,
    values: Record<string, string>,
  ) => string | null
}

interface SectionDef {
  id: string
  title: string // UI title
  envTitle: string // comment header in values.env
  desc?: string
  // optional + toggleKey: optional module, off by default. Only the toggleKey
  // field is always present; the rest participate in rendering, validation,
  // and output once enabled.
  optional?: boolean
  toggleKey?: string
  fields: FieldDef[]
}

const isIpOrHost = (v: string) =>
  /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/.test(v) ||
  /^\d{1,3}(\.\d{1,3}){3}$/.test(v)

const isNodePort = (v: string) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 30000 && n <= 32767
}

const isStorageSize = (v: string) => /^\d+(Gi|Mi|Ti)$/.test(v)

const requiredNonEmpty = (v: string) =>
  v.trim().length > 0 ? null : 'Required'

const SCHEMA: SectionDef[] = [
  // ===================== Required =====================
  {
    id: 'registry',
    title: 'Container Registry',
    envTitle: 'Container Registry',
    desc: 'Public registry path that holds all first-party images',
    fields: [
      {
        key: 'REGISTRY',
        kind: 'text',
        label: 'REGISTRY',
        hint: 'Registry path holding the images, no trailing slash. Default is the official public registry; override only to use a mirror',
        placeholder: 'ghcr.io/neutree-ai/agent-platform',
        default: 'ghcr.io/neutree-ai/agent-platform',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'IMAGE_TAG',
        kind: 'text',
        label: 'IMAGE_TAG',
        default: 'latest',
        hint: 'Tag for all first-party images. Pin to a release tag for a reproducible install',
      },
    ],
  },
  {
    id: 'cluster',
    title: 'Cluster & Access',
    envTitle: 'Cluster & Access',
    desc: 'K8s namespace, kubeconfig path, and the IP / NodePort users reach the platform at',
    fields: [
      {
        key: 'NAMESPACE',
        kind: 'text',
        label: 'NAMESPACE',
        default: 'nap',
      },
      {
        key: 'KUBECONFIG',
        kind: 'text',
        label: 'KUBECONFIG',
        default: './kubeconfig.yaml',
      },
      {
        key: 'TOS_HOST',
        kind: 'text',
        label: 'TOS_HOST',
        hint: 'IP or hostname users reach the platform at (one of the worker nodes)',
        placeholder: '10.0.0.100',
        required: true,
        validate: (v) =>
          v.trim() === ''
            ? 'Required'
            : isIpOrHost(v.trim())
              ? null
              : 'Must be an IP or hostname',
      },
      {
        key: 'TOS_NODE_PORT',
        kind: 'number',
        label: 'TOS_NODE_PORT',
        default: '30080',
        hint: 'Web UI + API. 30000–32767. Still rendered but not exposed when INGRESS_MODE=external',
        required: true,
        validate: (v) =>
          isNodePort(v) ? null : 'Must be a port in 30000–32767',
      },
      {
        key: 'INGRESS_MODE',
        kind: 'select',
        label: 'INGRESS_MODE',
        default: 'nodeport',
        hint: 'nodeport = default NodePort exposure; external = Services become ClusterIP and your own ingress fronts the HTTP services',
        options: ['nodeport', 'external'],
      },
    ],
  },
  {
    id: 'admin',
    title: 'Admin Account',
    envTitle: 'Admin Account',
    desc: 'Created by a seed Job on first install. JWT_SECRET signs session tokens',
    fields: [
      {
        key: 'ADMIN_USERNAME',
        kind: 'text',
        label: 'ADMIN_USERNAME',
        default: 'admin',
      },
      {
        key: 'ADMIN_PASSWORD',
        kind: 'password',
        label: 'ADMIN_PASSWORD',
        hint: 'At least 6 characters',
        required: true,
        validate: (v) =>
          v.length < 6 ? 'At least 6 characters' : null,
      },
      {
        key: 'ADMIN_DISPLAY_NAME',
        kind: 'text',
        label: 'ADMIN_DISPLAY_NAME',
        default: 'Admin',
      },
      {
        key: 'JWT_SECRET',
        kind: 'secret',
        label: 'JWT_SECRET',
        hint: 'Session token signing key. Generate with one click',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'CREDENTIAL_ENCRYPTION_KEY',
        kind: 'secret',
        label: 'CREDENTIAL_ENCRYPTION_KEY',
        hint: 'Credential encryption key (AES-256). Generate with one click; do not change it across upgrades',
        required: true,
        validate: requiredNonEmpty,
      },
    ],
  },
  {
    id: 'postgres',
    title: 'PostgreSQL',
    envTitle: 'PostgreSQL',
    fields: [
      {
        key: 'PG_USERNAME',
        kind: 'text',
        label: 'PG_USERNAME',
        default: 'nap',
      },
      {
        key: 'PG_PASSWORD',
        kind: 'secret',
        label: 'PG_PASSWORD',
        hint: 'Can be randomly generated with one click',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'PG_INSTANCES',
        kind: 'number',
        label: 'PG_INSTANCES',
        default: '3',
        hint: 'CNPG cluster replica count (including the primary). At least 3 in production',
        validate: (v) => {
          const n = Number(v)
          return Number.isInteger(n) && n >= 1
            ? null
            : 'Must be a positive integer'
        },
      },
      {
        key: 'PG_STORAGE_SIZE',
        kind: 'text',
        label: 'PG_STORAGE_SIZE',
        default: '10Gi',
        hint: 'Volume size per PostgreSQL instance, e.g. 10Gi / 100Gi',
        validate: (v) =>
          isStorageSize(v) ? null : 'Format: number + Gi/Mi/Ti',
      },
      {
        key: 'PG_STORAGE_CLASS',
        kind: 'text',
        label: 'PG_STORAGE_CLASS',
        hint: 'StorageClass for PostgreSQL volumes. Leave empty to use the cluster default StorageClass',
        placeholder: 'ceph-rbd',
      },
    ],
  },
  {
    id: 'storage',
    title: 'Shared Storage',
    envTitle: 'Shared Storage',
    desc: 'AFS backend + cross-node NFS (ReadWriteMany)',
    fields: [
      {
        key: 'NFS_SERVER',
        kind: 'text',
        label: 'NFS_SERVER',
        placeholder: '10.0.0.200',
        required: true,
        validate: (v) =>
          v.trim() === ''
            ? 'Required'
            : isIpOrHost(v.trim())
              ? null
              : 'Must be an IP or hostname',
      },
      {
        key: 'NFS_PATH',
        kind: 'text',
        label: 'NFS_PATH',
        placeholder: '/data/nap',
        default: '/data/nap',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'NFS_STORAGE_CLASS',
        kind: 'text',
        label: 'NFS_STORAGE_CLASS',
        default: 'nfs-nap',
        hint: 'Name of the StorageClass the NFS provisioner creates',
      },
      {
        key: 'AFS_STORAGE_SIZE',
        kind: 'text',
        label: 'AFS_STORAGE_SIZE',
        default: '500Gi',
        hint: 'Size of the AFS RWX PVC',
        validate: (v) =>
          isStorageSize(v) ? null : 'Format: number + Gi/Mi/Ti',
      },
    ],
  },
  {
    id: 'agent',
    title: 'Agent Runtime',
    envTitle: 'Agent Runtime',
    desc: 'Each workspace pod the control plane spawns dynamically',
    fields: [
      {
        key: 'AGENT_IMAGE_PREFIX',
        kind: 'text',
        label: 'AGENT_IMAGE_PREFIX',
        default: '${REGISTRY}/nap-agent',
        hint: 'References REGISTRY by default; supply a full prefix to customize',
      },
      {
        key: 'AGENT_IMAGE_TAG',
        kind: 'text',
        label: 'AGENT_IMAGE_TAG',
        default: 'latest',
      },
      {
        key: 'AGENT_STORAGE_CLASS',
        kind: 'text',
        label: 'AGENT_STORAGE_CLASS',
        default: 'nfs-csi',
        hint: 'StorageClass for agent workspace PVCs (ReadWriteOnce is fine). The volume root must be 0777 — the installer\'s nfs-subdir provisioner (nfs-nap) satisfies this. After install, verify the backend: kubectl get sc <class> -o jsonpath={.provisioner}; if it is nfs.csi.k8s.io / SFS the volume root is 0755 and agents hit mkdir EACCES, requiring mountPermissions:"0777"',
      },
      {
        key: 'AGENT_NODE_SELECTOR',
        kind: 'text',
        label: 'AGENT_NODE_SELECTOR',
        hint: 'Optional. Format: key1=val1,key2=val2',
      },
    ],
  },

  // ===================== Optional =====================
  {
    id: 'sandbox',
    title: 'Code Sandbox',
    envTitle: 'Code Sandbox',
    desc: 'Lets agents run code and serve temporary web previews',
    optional: true,
    toggleKey: 'SANDBOX_ENABLED',
    fields: [
      {
        key: 'SANDBOX_ENABLED',
        kind: 'boolean',
        label: 'SANDBOX_ENABLED',
        default: 'false',
      },
      {
        key: 'SANDBOX_NODE_PORT',
        kind: 'number',
        label: 'SANDBOX_NODE_PORT',
        default: '30086',
        required: true,
        validate: (v) =>
          isNodePort(v) ? null : 'Must be a port in 30000–32767',
      },
      {
        key: 'SANDBOX_JWT_SECRET',
        kind: 'secret',
        label: 'SANDBOX_JWT_SECRET',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'SANDBOX_SERVICE_KEY',
        kind: 'secret',
        label: 'SANDBOX_SERVICE_KEY',
        hint: 'Shared key between browser and sandbox',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'SANDBOX_DOMAIN',
        kind: 'text',
        label: 'SANDBOX_DOMAIN',
        placeholder: 'sandbox.example.com',
        hint: 'Optional. Subdomain preview requires wildcard DNS *.<domain>',
      },
      {
        key: 'SANDBOX_NODE_SELECTOR',
        kind: 'text',
        label: 'SANDBOX_NODE_SELECTOR',
        hint: 'Optional. key1=val1,key2=val2',
      },
      {
        key: 'SANDBOX_PUBLIC_URL',
        kind: 'text',
        label: 'SANDBOX_PUBLIC_URL',
        placeholder: 'https://sandbox.example.com',
        hint: 'Optional. Set when external ingress / a custom domain fronts the service; blank derives the NodePort URL',
      },
      {
        key: 'OPENSANDBOX_URL',
        kind: 'text',
        label: 'OPENSANDBOX_URL',
        placeholder: 'http://opensandbox-server.opensandbox-system.svc:80',
        hint: 'Optional. In-cluster URL of the third-party OpenSandbox server. Blank defaults to the server Service in the platform namespace',
      },
    ],
  },
  {
    id: 'browser',
    title: 'Remote Browser',
    envTitle: 'Remote Browser + TURN Relay',
    desc:
      'Lets agents drive a real browser while users watch live. The TURN relay is bundled with the browser and enabled together',
    optional: true,
    toggleKey: 'BROWSER_ENABLED',
    fields: [
      {
        key: 'BROWSER_ENABLED',
        kind: 'boolean',
        label: 'BROWSER_ENABLED',
        default: 'false',
      },
      {
        key: 'BROWSER_NODE_PORT',
        kind: 'number',
        label: 'BROWSER_NODE_PORT',
        default: '30085',
        required: true,
        validate: (v) =>
          isNodePort(v) ? null : 'Must be a port in 30000–32767',
      },
      {
        key: 'BROWSER_JWT_SECRET',
        kind: 'secret',
        label: 'BROWSER_JWT_SECRET',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'TURN_HOST',
        kind: 'text',
        label: 'TURN_HOST',
        hint: 'Public / LAN IP that browsers reach TURN at',
        required: true,
        validate: (v) =>
          v.trim() === ''
            ? 'Required'
            : isIpOrHost(v.trim())
              ? null
              : 'Must be an IP or hostname',
      },
      {
        key: 'TURN_PORT',
        kind: 'number',
        label: 'TURN_PORT',
        default: '3478',
      },
      {
        key: 'TURN_AUTH_SECRET',
        kind: 'secret',
        label: 'TURN_AUTH_SECRET',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'COTURN_NODE_SELECTOR',
        kind: 'text',
        label: 'COTURN_NODE_SELECTOR',
        hint: 'Recommended to pin to a single node. Empty = scheduler picks any',
      },
      {
        key: 'BROWSER_PUBLIC_URL',
        kind: 'text',
        label: 'BROWSER_PUBLIC_URL',
        placeholder: 'https://browsers.example.com',
        hint: 'Optional. Set when external ingress / a custom domain fronts the service; blank derives the NodePort URL',
      },
    ],
  },
  {
    id: 'ldap',
    title: 'LDAP',
    envTitle: 'LDAP',
    desc: 'Let users sign in with their LDAP account',
    optional: true,
    toggleKey: 'LDAP_ENABLED',
    fields: [
      {
        key: 'LDAP_ENABLED',
        kind: 'boolean',
        label: 'LDAP_ENABLED',
        default: 'false',
      },
      {
        key: 'LDAP_URL',
        kind: 'text',
        label: 'LDAP_URL',
        placeholder: 'ldap://ldap.example.com:389',
        required: true,
        validate: requiredNonEmpty,
      },
      {
        key: 'LDAP_BIND_DN',
        kind: 'text',
        label: 'LDAP_BIND_DN',
        placeholder: 'cn=admin,dc=example,dc=com',
      },
      {
        key: 'LDAP_BIND_PASSWORD',
        kind: 'password',
        label: 'LDAP_BIND_PASSWORD',
      },
      {
        key: 'LDAP_SEARCH_BASE',
        kind: 'text',
        label: 'LDAP_SEARCH_BASE',
        placeholder: 'ou=users,dc=example,dc=com',
      },
      {
        key: 'LDAP_SEARCH_FILTER',
        kind: 'text',
        label: 'LDAP_SEARCH_FILTER',
        placeholder: '(objectClass=inetOrgPerson)',
        hint: 'Leave blank to use the default (objectClass=inetOrgPerson). Override when your LDAP schema differs from the default.',
      },
      {
        key: 'LDAP_ATTR_USERNAME',
        kind: 'text',
        label: 'LDAP_ATTR_USERNAME',
        placeholder: 'sn',
        hint: 'Attribute matched against the login name; blank uses the default sn',
      },
      {
        key: 'LDAP_ATTR_NAME',
        kind: 'text',
        label: 'LDAP_ATTR_NAME',
        placeholder: 'cn',
        hint: 'Attribute used as the display name; blank uses the default cn',
      },
      {
        key: 'LDAP_ATTR_EMAIL',
        kind: 'text',
        label: 'LDAP_ATTR_EMAIL',
        placeholder: 'mail',
        hint: 'Attribute used as the email; blank uses the default mail',
      },
    ],
  },
]

const isSectionEnabled = (
  s: SectionDef,
  values: Record<string, string>,
) => !s.optional || values[s.toggleKey!] === 'true'

// Cross-field validation: NodePorts must not collide (only enabled sections)
function crossValidate(values: Record<string, string>) {
  const errors: Record<string, string> = {}
  const ports: Array<[string, string]> = [
    ['TOS_NODE_PORT', values.TOS_NODE_PORT],
  ]
  if (values.BROWSER_ENABLED === 'true')
    ports.push(['BROWSER_NODE_PORT', values.BROWSER_NODE_PORT])
  if (values.SANDBOX_ENABLED === 'true')
    ports.push(['SANDBOX_NODE_PORT', values.SANDBOX_NODE_PORT])
  const seen = new Map<string, string>()
  for (const [k, v] of ports) {
    if (!v) continue
    if (seen.has(v)) {
      errors[k] = `Conflicts with ${seen.get(v)}`
      errors[seen.get(v)!] = `Conflicts with ${k}`
    } else {
      seen.set(v, k)
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// One-click secret gen: crypto.getRandomValues(32B) → hex, equivalent to
// openssl rand -hex 32
// ---------------------------------------------------------------------------

function genHex32(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function buildInitial(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of SCHEMA) {
    for (const f of s.fields) {
      out[f.key] = f.default ?? ''
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Render the values.env text (English comments only, avoiding encoding issues)
// ---------------------------------------------------------------------------

function renderValuesEnv(values: Record<string, string>): string {
  const lines: string[] = []
  lines.push(
    '# ============================================================================',
  )
  lines.push('# Neutree Agent Platform Self-Hosted Deployment Configuration')
  lines.push('# Generated by nap.docs.neutree.ai configuration generator')
  lines.push(
    '# ============================================================================',
  )
  lines.push('')

  for (const s of SCHEMA) {
    const enabled = isSectionEnabled(s, values)
    const header = s.optional
      ? `# --- ${s.envTitle}${enabled ? '' : ' (disabled)'} ---`
      : `# --- ${s.envTitle} ---`
    lines.push(header)

    for (const f of s.fields) {
      // When an optional section is disabled, only emit the toggle, skip the rest
      if (s.optional && !enabled && f.key !== s.toggleKey) continue

      const v = values[f.key] ?? ''
      if (f.kind === 'password' && v === '') {
        lines.push(`${f.key}=`)
      } else {
        lines.push(`${f.key}=${v}`)
      }
    }

    // browser section special-case: COTURN_ENABLED is tied to BROWSER_ENABLED.
    // It is not controlled separately in the UI — mirror BROWSER_ENABLED's value.
    if (s.id === 'browser') {
      lines.push(
        `COTURN_ENABLED=${values.BROWSER_ENABLED === 'true' ? 'true' : 'false'}`,
      )
    }

    lines.push('')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Used for import: the set of all schema field names (including COTURN_ENABLED,
// which is derived from BROWSER_ENABLED — accepted but not stored).
const KNOWN_KEYS = (() => {
  const set = new Set<string>()
  for (const s of SCHEMA) for (const f of s.fields) set.add(f.key)
  set.add('COTURN_ENABLED')
  return set
})()

// Parse values.env text. Ignore blank lines, # comments, and lines without =; strip quotes.
function parseValuesEnv(text: string): {
  parsed: Record<string, string>
  unknown: string[]
} {
  const parsed: Record<string, string> = {}
  const unknown: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (KNOWN_KEYS.has(key)) {
      if (key !== 'COTURN_ENABLED') parsed[key] = val
    } else {
      unknown.push(key)
    }
  }
  return { parsed, unknown }
}

export default function ValuesGenerator() {
  const [values, setValues] = useState<Record<string, string>>(buildInitial)
  const [revealSecrets, setRevealSecrets] = useState(false)
  const [copyTip, setCopyTip] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const fieldErrors = useMemo(() => {
    const errs: Record<string, string> = {}
    for (const s of SCHEMA) {
      const enabled = isSectionEnabled(s, values)
      if (!enabled) continue // disabled optional modules aren't validated
      for (const f of s.fields) {
        if (s.optional && f.key === s.toggleKey) continue // the toggle field itself isn't validated
        const v = values[f.key] ?? ''
        if (f.required && v.trim() === '') {
          errs[f.key] = 'Required'
          continue
        }
        if (f.validate) {
          const e = f.validate(v, values)
          if (e) errs[f.key] = e
        }
      }
    }
    return { ...errs, ...crossValidate(values) }
  }, [values])

  const errorCount = Object.keys(fieldErrors).length
  const output = useMemo(() => renderValuesEnv(values), [values])

  const update = (key: string, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }))

  const fillAllSecrets = () => {
    setValues((prev) => {
      const next = { ...prev }
      for (const s of SCHEMA) {
        if (!isSectionEnabled(s, next)) continue
        for (const f of s.fields) {
          if (f.kind !== 'secret') continue
          if (!next[f.key] || next[f.key].trim() === '') {
            next[f.key] = genHex32()
          }
        }
      }
      return next
    })
  }

  const reset = () => setValues(buildInitial())

  const applyImport = () => {
    const { parsed, unknown } = parseValuesEnv(importText)
    const importedCount = Object.keys(parsed).length
    if (importedCount === 0 && unknown.length === 0) {
      setImportStatus('No fields parsed — check the pasted content')
      return
    }
    setValues((prev) => ({ ...prev, ...parsed }))
    const unknownTail =
      unknown.length === 0
        ? ''
        : `; ignored ${unknown.length} unrecognized field(s) (${unknown
            .slice(0, 3)
            .join(', ')}${unknown.length > 3 ? '…' : ''})`
    setImportStatus(`Imported ${importedCount} field(s)${unknownTail}`)
    setImportText('')
    setImportOpen(false)
    setTimeout(() => setImportStatus(null), 6000)
  }

  const download = () => {
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'values.env'
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(output)
    setCopyTip('Copied')
    setTimeout(() => setCopyTip(null), 1500)
  }

  const renderField = (f: FieldDef) => {
    const v = values[f.key] ?? ''
    const err = fieldErrors[f.key]
    const showAsSecret =
      (f.kind === 'secret' || f.kind === 'password') && !revealSecrets

    return (
      <div
        class={`vg-field ${err ? 'vg-field-err' : ''}`}
        key={f.key}
      >
        <label>
          <span class="vg-label-text">
            {f.label}
            {f.required && <span class="vg-req">*</span>}
          </span>
          {f.kind === 'boolean' ? (
            <select
              value={v}
              onChange={(e) =>
                update(f.key, (e.target as HTMLSelectElement).value)
              }
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : f.kind === 'select' ? (
            <select
              value={v}
              onChange={(e) =>
                update(f.key, (e.target as HTMLSelectElement).value)
              }
            >
              {(f.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : f.kind === 'secret' ? (
            <div class="vg-secret-row">
              <input
                type={showAsSecret ? 'password' : 'text'}
                value={v}
                placeholder={f.placeholder ?? 'click ↻ to generate'}
                onInput={(e) =>
                  update(f.key, (e.target as HTMLInputElement).value)
                }
              />
              <button
                type="button"
                class="vg-icon-btn"
                title="Generate a random 32-byte hex value"
                onClick={() => update(f.key, genHex32())}
              >
                ↻
              </button>
            </div>
          ) : (
            <input
              type={showAsSecret ? 'password' : 'text'}
              value={v}
              placeholder={f.placeholder}
              inputMode={f.kind === 'number' ? 'numeric' : 'text'}
              onInput={(e) =>
                update(f.key, (e.target as HTMLInputElement).value)
              }
            />
          )}
        </label>
        {f.hint && !err && <p class="vg-hint">{f.hint}</p>}
        {err && <p class="vg-error">{err}</p>}
      </div>
    )
  }

  return (
    <div class="vg-root">
      <div class="vg-toolbar">
        <div class="vg-toolbar-status">
          {errorCount === 0 ? (
            <span class="vg-ok">Validation passed</span>
          ) : (
            <span class="vg-err">{errorCount} field(s) need fixing</span>
          )}
        </div>
        <div class="vg-toolbar-actions">
          <button type="button" onClick={fillAllSecrets}>
            Generate secrets
          </button>
          <button
            type="button"
            onClick={() => setRevealSecrets((s) => !s)}
          >
            {revealSecrets ? 'Hide' : 'Show'} secrets
          </button>
          <button
            type="button"
            onClick={() => {
              setImportOpen((o) => !o)
              setImportStatus(null)
            }}
            class="vg-secondary"
          >
            {importOpen ? 'Collapse import' : 'Import existing values.env'}
          </button>
          <button type="button" onClick={reset} class="vg-secondary">
            Reset
          </button>
        </div>
      </div>

      {importOpen && (
        <div class="vg-import-panel">
          <p class="vg-import-hint">
            Paste an existing <code>values.env</code> here. Recognized fields are filled back into the form; unrecognized fields are ignored and counted. Fields added in newer versions keep their defaults, so you can scan the * required fields and fill them in.
          </p>
          <textarea
            class="vg-import-textarea"
            placeholder={'# paste an existing values.env\nREGISTRY=...\nTOS_HOST=...'}
            value={importText}
            onInput={(e) =>
              setImportText((e.target as HTMLTextAreaElement).value)
            }
          />
          <div class="vg-import-actions">
            <button
              type="button"
              class="vg-secondary"
              onClick={() => {
                setImportOpen(false)
                setImportText('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyImport}
              disabled={importText.trim() === ''}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {importStatus && (
        <div class="vg-import-status">{importStatus}</div>
      )}

      <div class="vg-grid">
        <form class="vg-form" onSubmit={(e) => e.preventDefault()}>
          {/* required first */}
          {SCHEMA.filter((s) => !s.optional).map((section) => (
            <fieldset key={section.id} class="vg-section">
              <legend>{section.title}</legend>
              {section.desc && (
                <p class="vg-section-desc">{section.desc}</p>
              )}
              {section.fields.map(renderField)}
            </fieldset>
          ))}

          {/* optional next */}
          <h4 class="vg-group-title">Optional modules</h4>
          {SCHEMA.filter((s) => s.optional).map((section) => {
            const enabled = isSectionEnabled(section, values)
            return (
              <fieldset
                key={section.id}
                class={`vg-section vg-section-optional ${
                  enabled ? 'vg-on' : 'vg-off'
                }`}
              >
                <legend>
                  <label class="vg-toggle">
                    <span class="vg-toggle-track">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          update(
                            section.toggleKey!,
                            (e.target as HTMLInputElement).checked
                              ? 'true'
                              : 'false',
                          )
                        }
                      />
                      <span class="vg-toggle-thumb" />
                    </span>
                    <span class="vg-toggle-label">{section.title}</span>
                  </label>
                </legend>
                {section.desc && (
                  <p class="vg-section-desc">{section.desc}</p>
                )}
                {enabled &&
                  section.fields
                    .filter((f) => f.key !== section.toggleKey)
                    .map(renderField)}
              </fieldset>
            )
          })}
        </form>

        <aside class="vg-preview">
          <div class="vg-preview-head">
            <span class="vg-preview-title">values.env preview</span>
            <div class="vg-preview-actions">
              <button type="button" onClick={copy}>
                {copyTip ?? 'Copy'}
              </button>
              <button
                type="button"
                onClick={download}
                disabled={errorCount > 0}
                title={errorCount > 0 ? 'Fix errors before downloading' : ''}
              >
                Download
              </button>
            </div>
          </div>
          <pre class="vg-preview-pre">{output}</pre>
        </aside>
      </div>
    </div>
  )
}
