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
  ) => VMsg | null
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

// ---------------------------------------------------------------------------
// Localization. Validation functions return a stable VMsg code; the UI maps
// it to a localized string. SCHEMA display strings (title/desc/label/hint/
// placeholder) carry the English source plus a parallel zh-CN override table
// keyed by section id / field key. Field keys, defaults, options, kinds and
// the generated values.env OUTPUT stay canonical/English.
// ---------------------------------------------------------------------------

type Locale = 'en' | 'zh-CN'

// Validation message codes (logic returns these; UI localizes them).
type VMsg =
  | 'required'
  | 'ipOrHost'
  | 'port'
  | 'positiveInt'
  | 'storageSize'
  | 'min6'
  | { conflict: string }

const requiredNonEmpty = (v: string): VMsg | null =>
  v.trim().length > 0 ? null : 'required'

const UI = {
  en: {
    vmsg: {
      required: 'Required',
      ipOrHost: 'Must be an IP or hostname',
      port: 'Must be a port in 30000–32767',
      positiveInt: 'Must be a positive integer',
      storageSize: 'Format: number + Gi/Mi/Ti',
      min6: 'At least 6 characters',
      conflict: (other: string) => `Conflicts with ${other}`,
    },
    optionalModules: 'Optional modules',
    validationPassed: 'Validation passed',
    fieldsNeedFixing: (n: number) => `${n} field(s) need fixing`,
    generateSecrets: 'Generate secrets',
    showSecrets: 'Show secrets',
    hideSecrets: 'Hide secrets',
    importExisting: 'Import existing values.env',
    collapseImport: 'Collapse import',
    reset: 'Reset',
    importHintPre: 'Paste an existing ',
    importHintPost:
      ' here. Recognized fields are filled back into the form; unrecognized fields are ignored and counted. Fields added in newer versions keep their defaults, so you can scan the * required fields and fill them in.',
    importPlaceholder: '# paste an existing values.env\nREGISTRY=...\nNAP_HOST=...',
    cancel: 'Cancel',
    apply: 'Apply',
    previewTitle: 'values.env preview',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    fixBeforeDownload: 'Fix errors before downloading',
    genSecretTitle: 'Generate a random 32-byte hex value',
    secretPlaceholder: 'click ↻ to generate',
    importNoFields: 'No fields parsed — check the pasted content',
    importResult: (count: number, tail: string) =>
      `Imported ${count} field(s)${tail}`,
    importIgnored: (n: number, names: string, more: boolean) =>
      `; ignored ${n} unrecognized field(s) (${names}${more ? '…' : ''})`,
  },
  'zh-CN': {
    vmsg: {
      required: '必填',
      ipOrHost: '必须是 IP 或主机名',
      port: '必须是 30000–32767 范围内的端口',
      positiveInt: '必须是正整数',
      storageSize: '格式：数字 + Gi/Mi/Ti',
      min6: '至少 6 个字符',
      conflict: (other: string) => `与 ${other} 冲突`,
    },
    optionalModules: '可选模块',
    validationPassed: '校验通过',
    fieldsNeedFixing: (n: number) => `${n} 个字段需要修正`,
    generateSecrets: '生成密钥',
    showSecrets: '显示密钥',
    hideSecrets: '隐藏密钥',
    importExisting: '导入已有 values.env',
    collapseImport: '收起导入',
    reset: '重置',
    importHintPre: '在此粘贴已有的 ',
    importHintPost:
      ' 。可识别的字段会回填到表单；无法识别的字段会被忽略并计数。新版本新增的字段保留默认值，你可以重点检查标 * 的必填字段并补全。',
    importPlaceholder: '# 粘贴已有的 values.env\nREGISTRY=...\nNAP_HOST=...',
    cancel: '取消',
    apply: '应用',
    previewTitle: 'values.env 预览',
    copy: '复制',
    copied: '已复制',
    download: '下载',
    fixBeforeDownload: '请先修正错误再下载',
    genSecretTitle: '生成一个随机的 32 字节十六进制值',
    secretPlaceholder: '点击 ↻ 生成',
    importNoFields: '未解析到任何字段 —— 请检查粘贴的内容',
    importResult: (count: number, tail: string) =>
      `已导入 ${count} 个字段${tail}`,
    importIgnored: (n: number, names: string, more: boolean) =>
      `；已忽略 ${n} 个无法识别的字段（${names}${more ? '…' : ''}）`,
  },
} as const

// localize a VMsg code
const locMsg = (locale: Locale, m: VMsg | null): string | undefined => {
  if (!m) return undefined
  const v = UI[locale].vmsg
  if (typeof m === 'object') return v.conflict(m.conflict)
  return v[m]
}

// zh-CN display overrides for SCHEMA. Keyed by section id (title/desc) and
// field key (label/hint/placeholder). label defaults to the canonical key when
// omitted (most fields display their env-var name verbatim in both locales).
const SCHEMA_ZH: {
  sections: Record<string, { title?: string; desc?: string }>
  fields: Record<
    string,
    { label?: string; hint?: string; placeholder?: string }
  >
} = {
  sections: {
    registry: {
      title: '容器镜像仓库',
      desc: '存放所有第一方镜像的公共镜像仓库路径',
    },
    registryAuth: {
      title: '私有仓库鉴权（可选）',
      desc: '仅当你的仓库需要登录时填写 —— 私有 / 镜像源 / 隔离网络仓库。公共或匿名仓库留空即可；安装器会据此创建 regcred imagePullSecret。',
    },
    cluster: {
      title: '集群与访问',
      desc: 'K8s 命名空间、kubeconfig 路径，以及用户访问平台所用的 IP / NodePort',
    },
    admin: {
      title: '管理员账号',
      desc: '首次安装时由 seed Job 创建。JWT_SECRET 用于签发会话令牌',
    },
    postgres: { title: 'PostgreSQL' },
    storage: {
      title: '共享存储',
      desc: 'AFS 后端 + 跨节点 NFS（ReadWriteMany）',
    },
    agent: {
      title: 'Agent 运行时',
      desc: '控制面动态拉起的每个 workspace pod',
    },
    sandbox: {
      title: 'Code Sandbox',
      desc: '让 agent 运行代码并提供临时的 web 预览',
    },
    browser: {
      title: 'Remote Browser',
      desc: '让 agent 操作真实浏览器，用户可实时观看。TURN relay 与浏览器捆绑，同步启用',
    },
    ldap: {
      title: 'LDAP',
      desc: '允许用户用 LDAP 账号登录',
    },
  },
  fields: {
    REGISTRY: {
      hint: '存放镜像的镜像仓库路径，结尾不带斜杠。默认是官方公共仓库；仅在使用镜像源时才覆盖',
    },
    IMAGE_TAG: {
      hint: '所有第一方镜像的 tag。固定到某个发布 tag 可获得可复现的安装',
    },
    REGISTRY_SERVER: {
      hint: '仓库主机名（用于生成 imagePullSecret）。仅当仓库需要鉴权时填写',
    },
    REGISTRY_USERNAME: {
      hint: '当仓库需要鉴权时填写；安装器会据此创建 regcred imagePullSecret',
    },
    NAP_HOST: {
      hint: '用户访问平台所用的 IP 或主机名（某个 worker 节点）',
    },
    NAP_NODE_PORT: {
      hint: 'Web UI + API。30000–32767。INGRESS_MODE=external 时仍会渲染但不对外暴露',
    },
    INGRESS_MODE: {
      hint: 'nodeport = 默认的 NodePort 暴露方式；external = Service 改为 ClusterIP，由你自己的 ingress 接管 HTTP 服务',
    },
    ADMIN_PASSWORD: { hint: '至少 6 个字符' },
    JWT_SECRET: { hint: '会话令牌签名密钥。可一键生成' },
    CREDENTIAL_ENCRYPTION_KEY: {
      hint: '凭据加密密钥（AES-256）。可一键生成；升级时不要更改',
    },
    PG_PASSWORD: { hint: '可一键随机生成' },
    PG_INSTANCES: {
      hint: 'CNPG 集群副本数（含主节点）。生产环境至少 3',
    },
    PG_STORAGE_SIZE: {
      hint: '每个 PostgreSQL 实例的卷大小，例如 10Gi / 100Gi',
    },
    PG_STORAGE_CLASS: {
      hint: 'PostgreSQL 卷使用的 StorageClass。留空则使用集群默认 StorageClass',
    },
    NFS_STORAGE_CLASS: {
      hint: 'NFS provisioner 创建的 StorageClass 名称',
    },
    AFS_STORAGE_SIZE: { hint: 'AFS RWX PVC 的大小' },
    AGENT_IMAGE_PREFIX: {
      hint: '默认引用 REGISTRY；可填写完整前缀进行自定义',
    },
    AGENT_STORAGE_CLASS: {
      hint: 'agent workspace PVC 使用的 StorageClass（ReadWriteOnce 即可）。卷根目录必须是 0777 —— 安装器自带的 nfs-subdir provisioner（nfs-nap）满足这一点。安装后请确认后端：kubectl get sc <class> -o jsonpath={.provisioner}；若为 nfs.csi.k8s.io / SFS，卷根目录是 0755，agent 会遇到 mkdir EACCES，需要设置 mountPermissions:"0777"',
    },
    AGENT_NODE_SELECTOR: {
      hint: '可选。格式：key1=val1,key2=val2',
    },
    SANDBOX_SERVICE_KEY: { hint: 'browser 与 sandbox 之间的共享密钥' },
    SANDBOX_DOMAIN: {
      hint: '可选。子域名预览需要通配 DNS *.<domain>',
    },
    SANDBOX_NODE_SELECTOR: { hint: '可选。key1=val1,key2=val2' },
    SANDBOX_PUBLIC_URL: {
      hint: '可选。当有外部 ingress / 自定义域名接管服务时设置；留空则推导出 NodePort URL',
    },
    OPENSANDBOX_URL: {
      hint: '可选。第三方 OpenSandbox server 的集群内 URL。留空则默认指向平台命名空间内的 server Service',
    },
    TURN_HOST: { hint: '浏览器访问 TURN 所用的公网 / 局域网 IP' },
    COTURN_NODE_SELECTOR: {
      hint: '建议固定到单个节点。留空 = 由调度器任意选择',
    },
    BROWSER_PUBLIC_URL: {
      hint: '可选。当有外部 ingress / 自定义域名接管服务时设置；留空则推导出 NodePort URL',
    },
    LDAP_SEARCH_FILTER: {
      hint: '留空则使用默认值 (objectClass=inetOrgPerson)。当你的 LDAP schema 与默认不同时覆盖。',
    },
    LDAP_ATTR_USERNAME: {
      hint: '与登录名匹配的属性；留空使用默认值 sn',
    },
    LDAP_ATTR_NAME: {
      hint: '用作显示名的属性；留空使用默认值 cn',
    },
    LDAP_ATTR_EMAIL: {
      hint: '用作邮箱的属性；留空使用默认值 mail',
    },
  },
}

// Resolve a section's localized display strings.
const secTitle = (locale: Locale, s: SectionDef) =>
  locale === 'en' ? s.title : (SCHEMA_ZH.sections[s.id]?.title ?? s.title)
const secDesc = (locale: Locale, s: SectionDef) =>
  locale === 'en' ? s.desc : (SCHEMA_ZH.sections[s.id]?.desc ?? s.desc)

// Resolve a field's localized display strings.
const fldLabel = (locale: Locale, f: FieldDef) =>
  locale === 'en' ? f.label : (SCHEMA_ZH.fields[f.key]?.label ?? f.label)
const fldHint = (locale: Locale, f: FieldDef) =>
  locale === 'en' ? f.hint : (SCHEMA_ZH.fields[f.key]?.hint ?? f.hint)
const fldPlaceholder = (locale: Locale, f: FieldDef) =>
  locale === 'en'
    ? f.placeholder
    : (SCHEMA_ZH.fields[f.key]?.placeholder ?? f.placeholder)

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
    id: 'registryAuth',
    title: 'Private registry auth (optional)',
    envTitle: 'Private Registry Auth (optional)',
    desc: 'Only when your registry needs a login — a private / mirrored / air-gapped registry. Leave blank for a public or anonymous one; the installer builds a regcred imagePullSecret from these.',
    fields: [
      {
        key: 'REGISTRY_SERVER',
        kind: 'text',
        label: 'REGISTRY_SERVER',
        hint: 'Registry hostname (used to build the imagePullSecret). Fill in only when the registry requires authentication',
        placeholder: 'registry.example.com',
      },
      {
        key: 'REGISTRY_USERNAME',
        kind: 'text',
        label: 'REGISTRY_USERNAME',
        hint: 'Fill in when the registry requires authentication; the installer builds a regcred imagePullSecret from it',
      },
      {
        key: 'REGISTRY_PASSWORD',
        kind: 'password',
        label: 'REGISTRY_PASSWORD',
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
        key: 'NAP_HOST',
        kind: 'text',
        label: 'NAP_HOST',
        hint: 'IP or hostname users reach the platform at (one of the worker nodes)',
        placeholder: '10.0.0.100',
        required: true,
        validate: (v) =>
          v.trim() === ''
            ? 'required'
            : isIpOrHost(v.trim())
              ? null
              : 'ipOrHost',
      },
      {
        key: 'NAP_NODE_PORT',
        kind: 'number',
        label: 'NAP_NODE_PORT',
        default: '30080',
        hint: 'Web UI + API. 30000–32767. Still rendered but not exposed when INGRESS_MODE=external',
        required: true,
        validate: (v) => (isNodePort(v) ? null : 'port'),
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
        validate: (v) => (v.length < 6 ? 'min6' : null),
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
          return Number.isInteger(n) && n >= 1 ? null : 'positiveInt'
        },
      },
      {
        key: 'PG_STORAGE_SIZE',
        kind: 'text',
        label: 'PG_STORAGE_SIZE',
        default: '10Gi',
        hint: 'Volume size per PostgreSQL instance, e.g. 10Gi / 100Gi',
        validate: (v) => (isStorageSize(v) ? null : 'storageSize'),
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
        validate: (v) => (isStorageSize(v) ? null : 'storageSize'),
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
  const errors: Record<string, VMsg> = {}
  const ports: Array<[string, string]> = [
    ['NAP_NODE_PORT', values.NAP_NODE_PORT],
  ]
  if (values.BROWSER_ENABLED === 'true')
    ports.push(['BROWSER_NODE_PORT', values.BROWSER_NODE_PORT])
  if (values.SANDBOX_ENABLED === 'true')
    ports.push(['SANDBOX_NODE_PORT', values.SANDBOX_NODE_PORT])
  const seen = new Map<string, string>()
  for (const [k, v] of ports) {
    if (!v) continue
    if (seen.has(v)) {
      errors[k] = { conflict: seen.get(v)! }
      errors[seen.get(v)!] = { conflict: k }
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

export default function ValuesGenerator({ locale = 'en' }: { locale?: string }) {
  const loc: Locale = locale === 'zh-CN' ? 'zh-CN' : 'en'
  const ui = UI[loc]
  const [values, setValues] = useState<Record<string, string>>(buildInitial)
  const [revealSecrets, setRevealSecrets] = useState(false)
  const [copyTip, setCopyTip] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const fieldErrors = useMemo(() => {
    const errs: Record<string, VMsg> = {}
    for (const s of SCHEMA) {
      const enabled = isSectionEnabled(s, values)
      if (!enabled) continue // disabled optional modules aren't validated
      for (const f of s.fields) {
        if (s.optional && f.key === s.toggleKey) continue // the toggle field itself isn't validated
        const v = values[f.key] ?? ''
        if (f.required && v.trim() === '') {
          errs[f.key] = 'required'
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
      setImportStatus(ui.importNoFields)
      return
    }
    setValues((prev) => ({ ...prev, ...parsed }))
    const unknownTail =
      unknown.length === 0
        ? ''
        : ui.importIgnored(
            unknown.length,
            unknown.slice(0, 3).join(', '),
            unknown.length > 3,
          )
    setImportStatus(ui.importResult(importedCount, unknownTail))
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
    setCopyTip(ui.copied)
    setTimeout(() => setCopyTip(null), 1500)
  }

  const renderField = (f: FieldDef) => {
    const v = values[f.key] ?? ''
    const err = locMsg(loc, fieldErrors[f.key] ?? null)
    const showAsSecret =
      (f.kind === 'secret' || f.kind === 'password') && !revealSecrets

    return (
      <div
        class={`vg-field ${err ? 'vg-field-err' : ''}`}
        key={f.key}
      >
        <label>
          <span class="vg-label-text">
            {fldLabel(loc, f)}
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
                placeholder={fldPlaceholder(loc, f) ?? ui.secretPlaceholder}
                onInput={(e) =>
                  update(f.key, (e.target as HTMLInputElement).value)
                }
              />
              <button
                type="button"
                class="vg-icon-btn"
                title={ui.genSecretTitle}
                onClick={() => update(f.key, genHex32())}
              >
                ↻
              </button>
            </div>
          ) : (
            <input
              type={showAsSecret ? 'password' : 'text'}
              value={v}
              placeholder={fldPlaceholder(loc, f)}
              inputMode={f.kind === 'number' ? 'numeric' : 'text'}
              onInput={(e) =>
                update(f.key, (e.target as HTMLInputElement).value)
              }
            />
          )}
        </label>
        {fldHint(loc, f) && !err && <p class="vg-hint">{fldHint(loc, f)}</p>}
        {err && <p class="vg-error">{err}</p>}
      </div>
    )
  }

  return (
    <div class="vg-root">
      <div class="vg-toolbar">
        <div class="vg-toolbar-status">
          {errorCount === 0 ? (
            <span class="vg-ok">{ui.validationPassed}</span>
          ) : (
            <span class="vg-err">{ui.fieldsNeedFixing(errorCount)}</span>
          )}
        </div>
        <div class="vg-toolbar-actions">
          <button type="button" onClick={fillAllSecrets}>
            {ui.generateSecrets}
          </button>
          <button
            type="button"
            onClick={() => setRevealSecrets((s) => !s)}
          >
            {revealSecrets ? ui.hideSecrets : ui.showSecrets}
          </button>
          <button
            type="button"
            onClick={() => {
              setImportOpen((o) => !o)
              setImportStatus(null)
            }}
            class="vg-secondary"
          >
            {importOpen ? ui.collapseImport : ui.importExisting}
          </button>
          <button type="button" onClick={reset} class="vg-secondary">
            {ui.reset}
          </button>
        </div>
      </div>

      {importOpen && (
        <div class="vg-import-panel">
          <p class="vg-import-hint">
            {ui.importHintPre}<code>values.env</code>{ui.importHintPost}
          </p>
          <textarea
            class="vg-import-textarea"
            placeholder={ui.importPlaceholder}
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
              {ui.cancel}
            </button>
            <button
              type="button"
              onClick={applyImport}
              disabled={importText.trim() === ''}
            >
              {ui.apply}
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
              <legend>{secTitle(loc, section)}</legend>
              {secDesc(loc, section) && (
                <p class="vg-section-desc">{secDesc(loc, section)}</p>
              )}
              {section.fields.map(renderField)}
            </fieldset>
          ))}

          {/* optional next */}
          <h4 class="vg-group-title">{ui.optionalModules}</h4>
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
                    <span class="vg-toggle-label">{secTitle(loc, section)}</span>
                  </label>
                </legend>
                {secDesc(loc, section) && (
                  <p class="vg-section-desc">{secDesc(loc, section)}</p>
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
            <span class="vg-preview-title">{ui.previewTitle}</span>
            <div class="vg-preview-actions">
              <button type="button" onClick={copy}>
                {copyTip ?? ui.copy}
              </button>
              <button
                type="button"
                onClick={download}
                disabled={errorCount > 0}
                title={errorCount > 0 ? ui.fixBeforeDownload : ''}
              >
                {ui.download}
              </button>
            </div>
          </div>
          <pre class="vg-preview-pre">{output}</pre>
        </aside>
      </div>
    </div>
  )
}
