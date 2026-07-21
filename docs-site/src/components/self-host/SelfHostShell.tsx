import { useEffect, useRef, useState } from 'preact/hooks'
import AirgapBlock from './AirgapBlock'
import CodeBlock from './CodeBlock'
import ValuesGenerator from './ValuesGenerator'
import './self-host-shell.css'

interface TocItem {
  id: string
  text: string
}

type TabId =
  | 'overview'
  | 'configure'
  | 'install'
  | 'upgrade'
  | 'troubleshoot'

interface TabDef {
  id: TabId
  label: string
  hint: string
}

const STR = {
  en: {
    headEyebrow: 'Neutree Agent Platform — Self-Host',
    headTag: 'Install the platform on your own Kubernetes cluster — pulling images from a public registry, or fully air-gapped from your own',
    printTitle: 'Print all sections together or export to PDF',
    printBtn: 'Print / Export PDF',
    tocLabel: 'On this page',
    tabs: {
      overview: { label: 'Overview', hint: 'Capabilities & prerequisites' },
      configure: { label: 'Configure', hint: 'Generate values.env interactively' },
      install: { label: 'Install', hint: 'Quick start, script, subcommands' },
      upgrade: { label: 'Upgrade', hint: 'One-command upgrade path' },
      troubleshoot: { label: 'Troubleshoot', hint: 'Common failures & diagnosis' },
    },
  },
  'zh-CN': {
    headEyebrow: 'Neutree Agent Platform — 私有化部署',
    headTag: '在你自己的 Kubernetes 集群上安装平台 —— 从公共镜像仓库拉取镜像，或从你自己的私有仓库完全离线部署',
    printTitle: '将所有章节一起打印或导出为 PDF',
    printBtn: '打印 / 导出 PDF',
    tocLabel: '本页目录',
    tabs: {
      overview: { label: '概览', hint: '能力与前置条件' },
      configure: { label: '配置', hint: '交互式生成 values.env' },
      install: { label: '安装', hint: '快速开始、脚本、子命令' },
      upgrade: { label: '升级', hint: '一条命令完成升级' },
      troubleshoot: { label: '排障', hint: '常见故障与诊断' },
    },
  },
} as const

function readHashTab(): TabId {
  if (typeof window === 'undefined') return 'overview'
  const h = window.location.hash.replace(/^#/, '') as TabId
  const ids: TabId[] = ['overview', 'configure', 'install', 'upgrade', 'troubleshoot']
  return ids.includes(h) ? h : 'overview'
}

export default function SelfHostShell({ locale = 'en' }: { locale?: string }) {
  const t = STR[locale as keyof typeof STR] ?? STR.en
  const TABS: TabDef[] = [
    { id: 'overview', label: t.tabs.overview.label, hint: t.tabs.overview.hint },
    { id: 'configure', label: t.tabs.configure.label, hint: t.tabs.configure.hint },
    { id: 'install', label: t.tabs.install.label, hint: t.tabs.install.hint },
    { id: 'upgrade', label: t.tabs.upgrade.label, hint: t.tabs.upgrade.hint },
    { id: 'troubleshoot', label: t.tabs.troubleshoot.label, hint: t.tabs.troubleshoot.hint },
  ]

  // Initial state must be fixed to 'overview' to match the SSR output.
  // If the useState initializer read location.hash directly, the client's first
  // render would diverge from SSR (no window during SSR, always 'overview'); on
  // hydration Preact sees the tab nodes' classes don't match and bails, so the
  // tab highlight stays stuck on the SSR version and later setState won't reconcile.
  const [active, setActive] = useState<TabId>('overview')
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Sync hash → state after mount to avoid the hydration mismatch.
  // hashchange covers browser back/forward and external links.
  useEffect(() => {
    setActive(readHashTab())
    const onHash = () => setActive(readHashTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // state → hash (synced on tab click)
  const goto = (id: TabId) => {
    if (id === active) return
    history.pushState(null, '', `#${id}`)
    setActive(id)
    // scroll back to top on tab switch
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }

  // After switching tabs, scan the panel's h2[id] once to build the current tab's TOC
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const root = panelRef.current
      if (!root) return
      const items: TocItem[] = Array.from(
        root.querySelectorAll<HTMLHeadingElement>('h2[id]'),
      ).map((h) => ({ id: h.id, text: h.textContent ?? '' }))
      setToc(items)
      setActiveId(items[0]?.id ?? '')
    })
    return () => cancelAnimationFrame(raf)
  }, [active])

  // IntersectionObserver tracks the currently visible heading and highlights the TOC item
  useEffect(() => {
    if (toc.length < 2) return
    const root = panelRef.current
    if (!root) return
    const headings = Array.from(
      root.querySelectorAll<HTMLHeadingElement>('h2[id]'),
    )
    if (headings.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        // pick the topmost heading currently intersecting the viewport top
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      // leave room at the top for the sticky tab nav
      { rootMargin: '-100px 0px -60% 0px', threshold: 0 },
    )
    headings.forEach((h) => obs.observe(h))
    return () => obs.disconnect()
  }, [toc])

  const onTocClick = (e: Event, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }

  const hasToc = toc.length >= 2

  return (
    <div class="sh-root not-content">
      <header class="sh-head">
        <div class="sh-head-row">
          <div class="sh-head-title">
            <span class="sh-head-eyebrow">{t.headEyebrow}</span>
            <span class="sh-head-tag">{t.headTag}</span>
          </div>
          <button
            type="button"
            class="sh-print-btn"
            onClick={() => window.print()}
            title={t.printTitle}
            data-no-print
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            {t.printBtn}
          </button>
        </div>
        <nav class="sh-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={tab.id === active}
              class={`sh-tab ${tab.id === active ? 'sh-tab-active' : ''}`}
              onClick={() => goto(tab.id)}
            >
              <span class="sh-tab-label">{tab.label}</span>
              <span class="sh-tab-hint">{tab.hint}</span>
            </button>
          ))}
        </nav>
      </header>

      <div class={`sh-body ${hasToc ? 'sh-body-with-toc' : ''}`}>
        <main class="sh-panel" role="tabpanel" ref={panelRef}>
          {active === 'overview' && <Overview onGo={goto} locale={locale} />}
          {active === 'configure' && <Configure locale={locale} />}
          {active === 'install' && <Install onGo={goto} locale={locale} />}
          {active === 'upgrade' && <Upgrade locale={locale} />}
          {active === 'troubleshoot' && <Troubleshoot locale={locale} />}
        </main>

        {hasToc && (
          <aside class="sh-toc" aria-label={t.tocLabel}>
            <div class="sh-toc-label">{t.tocLabel}</div>
            <ul>
              {toc.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    class={item.id === activeId ? 'sh-toc-active' : ''}
                    onClick={(e) => onTocClick(e, item.id)}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {/* Always mounted so browser-native Ctrl+P works too; hidden on screen via CSS. */}
      <div class="sh-print-all" aria-hidden="true">
        {TABS.map((tab) => (
          <section class="sh-print-section" key={tab.id}>
            <h1 class="sh-print-h1">{tab.label}</h1>
            {tab.id === 'overview' && <Overview onGo={() => {}} locale={locale} />}
            {tab.id === 'configure' && <Configure locale={locale} />}
            {tab.id === 'install' && <Install onGo={() => {}} locale={locale} />}
            {tab.id === 'upgrade' && <Upgrade locale={locale} />}
            {tab.id === 'troubleshoot' && <Troubleshoot locale={locale} />}
          </section>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const PANEL_STR = {
  en: {
    // Overview
    ovCapH2: 'What one install gives you',
    ovIntro: (
      <>
        The same <code>./install.sh</code> brings up the platform connected (images pulled from a public registry) or fully air-gapped (from your own registry) — the Install tab covers both. What it installs:
      </>
    ),
    ovCoreH3: 'Core platform (always installed)',
    ovCoreControl: <><strong>Control plane</strong> — agent management, scheduling, user and workspace management</>,
    ovCoreGateway: <><strong>Channel gateway</strong> — the entry point for external events (webhooks, Slack, etc.) to reach agents</>,
    ovCoreData: <><strong>Data layer</strong> — PostgreSQL (CloudNativePG) + shared NFS</>,
    ovCoreRuntime: <><strong>Agent workspace runtime</strong> — one pod per workspace runs the agent; agents can <code>@</code> each other, share files, and share a memory store</>,
    ovOptH3: 'Optional modules (off by default)',
    ovOptSandbox: <><strong>Code Sandbox</strong> — lets agents run code and serve temporary web previews. Powered by the third-party <a href="https://github.com/alibaba/OpenSandbox">OpenSandbox</a>, which you install yourself; the platform points at it via <code>OPENSANDBOX_URL</code></>,
    ovOptBrowser: <><strong>Agent Browser</strong> — self-hosted browser as a service: agents drive a real browser while users watch live over WebRTC. Ships a bundled TURN relay (coturn) and a published headful Chromium image</>,
    ovOptLdap: <><strong>LDAP</strong> — let users sign in with their LDAP account</>,
    ovPrereqH2: 'Prerequisites',
    ovInfraH3: 'Infrastructure',
    ovThResource: 'Resource',
    ovThRequirement: 'Requirement',
    ovThNotes: 'Notes',
    ovK8s: 'Kubernetes',
    ovK8sReq: 'v1.28+ (multi-node), or a single k3s node (single-node profile)',
    ovK8sNote: '3+ workers recommended',
    ovWorkers: 'Worker nodes',
    ovWorkersReq: '4 vCPU / 8GB RAM minimum',
    ovWorkersNote: 'Agent pods are created per workspace dynamically',
    ovRegAccess: 'Container registry',
    ovRegAccessReq: <>A registry every node can pull from — a public one (connected) or your own private registry (air-gapped)</>,
    ovRegAccessNote: <>Set <code>REGISTRY</code> to it; fill <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> when it needs a login</>,
    ovRwx: 'RWX shared storage',
    ovRwxReq: 'A CSI that supports ReadWriteMany (NFS is the most common)',
    ovRwxNote: 'Backs the AFS shared directory, 500Gi by default',
    ovRwo: 'RWO volume storage',
    ovRwoReq: 'Any CSI that can run PostgreSQL (Ceph RBD, vSAN, etc.; the same NFS also works)',
    ovRwoNote: 'PostgreSQL data volumes + agent workspace container disks',
    ovNetH3: 'Network',
    ovThItem: 'Item',
    ovNodeIp: 'Node IP',
    ovNodeIpReq: 'At least one worker IP reachable by users (NodePort uses it)',
    ovNodePort: 'NodePort',
    ovNodePortReq: <>Free ports in 30000–32767: <code>NAP_NODE_PORT</code>, plus <code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code> when the corresponding optional module is enabled</>,
    ovTurnPorts: 'TURN ports',
    ovTurnPortsReq: <>When the Agent Browser's TURN relay is enabled: open <code>3478/tcp+udp</code> and <code>49152-49252/udp</code> on the coturn node</>,
    ovStorageReach: 'Storage reachability',
    ovStorageReachReq: 'All nodes can mount the two storage classes above (NFS / block-storage CSI, etc.)',
    ovRegReach: 'Registry reachability',
    ovRegReachReq: 'All nodes can pull images from the registry above (a public one, or your private registry)',
    ovLlmH3: 'LLM API',
    ovLlmIntro: 'The platform does not bundle any model. Depending on the agent types you enable, you must provide protocol-compatible API endpoints:',
    ovThAgentType: 'Agent type',
    ovThApiProto: 'API protocol required',
    ovCodexProto: <>OpenAI <strong>Responses API</strong> (note: not Chat Completions)</>,
    ovClaudeProto: 'Anthropic API',
    ovGooseProto: <>OpenAI <strong>Chat Completions API</strong></>,
    ovLlmNote: <>If your existing model service only supports the <strong>OpenAI Chat Completions API</strong>, Goose agents can use it directly. To also run Claude Code-style agents against it, put a translating proxy in front that converts the OpenAI Chat protocol to the Anthropic protocol.</>,
    ovKubeH3: 'kubeconfig permissions',
    ovKubeP1: <>Installation requires <strong>cluster-admin</strong> — <code>install.sh</code> touches resources that a namespace-scoped admin cannot (CRDs, webhooks, ClusterRoles, StorageClasses, etc.). You can revoke it immediately after install; at steady state the control plane authenticates via its own in-cluster ServiceAccount with tightly scoped permissions (normal read/write within the namespace + cluster-scoped get/list on <code>nodes</code> only).</>,
    ovKubeP2: <>The operator's kubeconfig is never mounted into any platform pod. If a temporary cluster-admin is not acceptable, here is an equivalent minimal ClusterRole.</>,
    ovClusterRoleSummary: 'Equivalent minimal ClusterRole',
    ovClusterRoleNote: <>This is still close to cluster-admin in practice (<code>*/*</code> on the core/apps/batch groups), but spelling out the resources makes a security review easier.</>,
    ovCtaIntro: 'Once the prerequisites are in place:',
    ovCtaStart: 'Start configuring →',
    ovCtaSkip: 'Already have values.env — go to install',
    // Configure
    cfgIntro: (
      <>
        Fill in the form for your environment; <code>values.env</code> is previewed live on the right. Everything is processed locally — <strong>nothing is uploaded</strong>. Secrets are generated with{' '}
        <code>crypto.getRandomValues</code> (equivalent to{' '}
        <code>openssl rand -hex 32</code>). <strong>Once a machine-internal secret is set, do not change it on upgrade</strong> — otherwise issued session tokens and the existing database become unusable.
      </>
    ),
    cfgPrintNote: <>The interactive configuration generator is online at <a href="https://nap.docs.neutree.ai/self-host/#configure">nap.docs.neutree.ai/self-host/#configure</a>. For full field documentation see <code>self-host/values.env.example</code>.</>,
    // Install
    inToolsH2: 'Tools on the operator machine',
    inToolsIntro: 'The host running the installer (distinct from the cluster nodes) needs:',
    inToolKubectl: <><code>kubectl</code> — a version compatible with the target cluster</>,
    inToolEnvsubst: <><code>envsubst</code> — usually shipped with the <code>gettext</code> package</>,
    inToolOpenssl: <><code>openssl</code> — used by <code>gen-secrets.sh</code> to generate random secrets</>,
    inToolHelm: <><code>helm</code> 3.x — only needed when the cluster doesn't already have an NFS provisioner; invoked by <code>install.sh</code>'s prerequisites stage</>,
    inToolLoader: <><code>docker</code> or <code>nerdctl</code> — used by <code>offline/load-images.sh</code> to push the image bundle into your registry (air-gapped installs only)</>,
    inToolsNote: <>The cluster nodes (not the operator machine) must be able to pull from your <code>REGISTRY</code>. Connected, that's a public registry (<code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>); air-gapped, it's your own registry and they never touch the internet.</>,
    inQuickH2: 'Quick start',
    inQuickAfter: <>When it finishes, open <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code> and log in with the admin username / password from <code>values.env</code>.</>,
    inQuickAltP: <>Or skip the clone — the bootstrap script fetches the installer itself and targets your current kubeconfig. Two things can't be autodetected: the host users will reach the platform at, and RWX storage (an external NFS export, or an RWX-capable StorageClass that already exists in the cluster):</>,
    inQuickAltNote: <>This installs the full profile with defaults; add <code>--prepare-only</code> to review <code>/opt/nap/values.env</code> first, then re-run without it.</>,
    inStepsH2: 'Step by step',
    inStep1H3: 'Get the installer',
    inStep1Note: <>For a connected install, all first-party images are pulled from the public registry (<code>${'{'}REGISTRY{'}'}</code>, default <code>ghcr.io/neutree-ai/agent-platform</code>). Override <code>REGISTRY</code> only if you mirror the images elsewhere.</>,
    agInstallSummary: 'build the image bundle and push it into your registry',
    agInstall1: <>On a connected host, <code>./offline/save-images.sh</code> pulls every first-party and prerequisite image and writes <code>offline/nap-images.tar.gz</code> plus the prereq charts under <code>prereqs/</code>. Move it to the air-gapped side, then <code>./offline/load-images.sh --registry &lt;your-registry&gt;</code> (add <code>--insecure-registry</code> for a plain-HTTP registry) loads, retags, and pushes every image into your registry and prints the exact <code>REGISTRY=</code> / <code>*_IMAGE=</code> lines to paste into <code>values.env</code>. If a vendor delivered a prebuilt bundle, skip <code>save-images</code> and start at <code>load-images</code>.</>,
    agInstall2: <>With those set, the remaining steps run exactly as they do online — <code>./install.sh</code> auto-detects the offline prereq bundles and builds the pull secret from <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code>. For a single machine with no external registry, use the <a href="/self-host/single-node/">single-node profile</a> instead.</>,
    agPrefix: <><strong>Naming.</strong> Every first-party image carries the <code>values.env</code> <code>APP_PREFIX</code> (default <code>nap</code>, as in <code>nap-cp</code>). It is for <strong>redistributors only</strong> — a non-default prefix requires every first-party image to be rebuilt under that prefix in your own registry; the public registry only hosts <code>nap-*</code>, and the installer refuses the combination. A redistribution that kept a different prefix builds the bundle with its own <code>values.env</code> and runs <code>load-images.sh --app-prefix &lt;prefix&gt;</code> so the loader finds the prefixed images. The installer also refuses to change the prefix of an existing install.</>,
    inRegAuthNote: <>If your registry needs a login, set <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> in <code>values.env</code> — the installer builds a <code>regcred</code> imagePullSecret from them automatically and attaches it to the platform, CNPG, and the workspace pods.</>,
    inStep2H3: 'Prepare values.env',
    inStep2GenBtn: 'configuration generator',
    inStep2P1Pre: 'We recommend the',
    inStep2P1Post: '— fill it in online, download the result, and place it in the ',
    inStep2P1End: ' directory.',
    inStep2Note: <>You can also edit it on the command line: <code>cp values.env.example values.env</code>, run <code>./gen-secrets.sh</code> to fill all machine-internal secrets, then <code>vi values.env</code> to set <code>NAP_HOST</code>, the admin password, and storage settings.</>,
    inStep3H3: 'Run the installer',
    inStep3P: <>The same command serves first-time install and upgrade; it is idempotent and safe to re-run. It installs prerequisites (the CloudNativePG operator and the NFS subdir provisioner), renders the manifests with your <code>values.env</code> and applies them, then seeds the admin user, OAuth clients, and the MCP catalog via one-shot Jobs. <code>nap-cp</code> runs SQL migrations on startup.</>,
    inStep4H3: 'Log in',
    inStep4P: <>Open <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code> in a browser and log in with <code>ADMIN_USERNAME</code> and the <code>ADMIN_PASSWORD</code> from{' '}<code>values.env</code>.</>,
    inSubH2: 'install.sh subcommands',
    inSubIntro: <>For running stages separately; a single <code>./install.sh</code> is enough for the normal case.</>,
    inSingleH2: 'Single-node profile',
    inSingleP: <>A single k3s node — same as the full profile, just with <code>PG_INSTANCES=1</code> and an in-cluster NFS server for RWX storage (a single node has no external NFS). <strong>Connected</strong>, it pulls every image from the public registry. <strong>Air-gapped</strong>, it brings up an in-cluster registry and seeds it from the image bundle, so no external registry is needed at all. The <a href="/self-host/single-node/">single-node page</a> covers both paths end to end.</>,
    // Upgrade
    upPathH2: 'Upgrade',
    upPathP1: <>Upgrading is the same command as a first install. First refresh the installer itself to the new release (<code>git pull</code> in the cloned repo — the new manifests ship with it), pin <code>IMAGE_TAG</code> to the new release tag (or keep <code>latest</code>) in your existing <code>values.env</code>, then re-run:</>,
    upPathP2: <><code>install.sh</code> is idempotent, so the upgrade path matches the first install. It re-renders and re-applies the manifests and refreshes the first-party deployments to pick up new image digests. SQL migrations run automatically when <code>nap-cp</code> starts.</>,
    upCallout: <><strong>Do not change secrets</strong> · Reuse the <code>values.env</code> from your first install. If a machine-internal secret (e.g. <code>JWT_SECRET</code>) changes, all issued session tokens are invalidated and the existing database can no longer be reached.</>,
    agUpgradeSummary: 'refresh the installer and the registry contents first',
    agUpgrade: <>Refresh both halves first: on the connected host re-run <code>offline/save-images.sh</code> to build a bundle with the new tags, copy the new <code>self-host/</code> directory together with the bundle to the air-gapped side, push with <code>offline/load-images.sh</code>, then run the same <code>./install.sh</code>.</>,
    // Troubleshoot
    tsErrH2: 'install.sh fails',
    tsErrIntro: <>First find the deployment that isn't ready (replace <code>$NAMESPACE</code> with{' '}<code>NAMESPACE</code> from <code>values.env</code>, default <code>nap</code>):</>,
    tsErrCommon: 'Common causes:',
    tsErrPull: <><strong>Images won't pull</strong> → <strong>connected</strong>: confirm the nodes can reach{' '}<code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>. <strong>Air-gapped</strong>: confirm <code>load-images.sh</code> pushed the bundle into your <code>REGISTRY</code> and that <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> are set — the installer builds the regcred pull secret from them. A plain-HTTP registry also needs the nodes' container runtime to trust it as insecure.</>,
    tsErrPvc: <><strong>PVCs stuck Pending</strong> → run{' '}<code>kubectl -n $NAMESPACE get pvc</code> and check the StorageClass exists and its provisioner is healthy</>,
    tsErrPg: <><strong>PostgreSQL won't start</strong> →{' '}<code>kubectl -n $NAMESPACE describe cluster.postgresql.cnpg.io nap-pg</code>; the most common cause is the CSI behind <code>PG_STORAGE_CLASS</code> not being writable</>,
    tsErrPort: <><strong>NodePort already in use</strong> → change <code>NAP_NODE_PORT</code> /{' '}<code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code> and re-run{' '}<code>install.sh</code></>,
    tsBlankH2: 'Blank page after login / APIs return 401',
    tsBlankP: <>Usually because <code>JWT_SECRET</code> changed during an upgrade — all issued tokens are invalidated. Roll <code>JWT_SECRET</code> in{' '}<code>values.env</code> back to its first-install value and re-run{' '}<code>./install.sh</code>.</>,
    tsReachH2: 'Cannot reach the platform',
    tsReachP: <>The browser gets no response at <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code>. Two common causes:</>,
    tsReachHost: <><strong><code>NAP_HOST</code> is unreachable</strong> — the configured IP is not a worker node reachable from the browser. Set the correct node IP and re-run <code>install.sh</code></>,
    tsReachPort: <><strong>NodePort not open</strong> — the node firewall blocks the port; ask your SRE to open it</>,
    tsEaccesH2: <>Agent fails to start: <code>mkdir /workspace/.home/.claude: EACCES</code></>,
    tsEaccesP1: <>The agent container runs as a non-root user (<code>node</code>, uid 1000), and <code>/workspace</code> is a mounted PVC.
          If that PVC is backed by the community <code>nfs.csi.k8s.io</code> driver, <strong>that driver does not chmod the provisioned subdirectory by default</strong>
          (per its docs, <code>mountPermissions</code> defaults to <code>0</code>; chmod only runs when non-zero), so subdirectory permissions come from the NFS server's default <code>mkdir</code> umask — typically <code>root:root 0755</code>, which uid 1000 cannot write to.</>,
    tsEaccesVerify: 'Verify on the NFS server:',
    tsEaccesFix: <><strong>Fix</strong>: add <code>mountPermissions: "0777"</code> (as a string) to the StorageClass <code>parameters</code>, then delete the failed PVC and let the control plane recreate it. This only affects newly provisioned PVs; existing subdirectories need a manual <code>chmod 0777</code> on the NFS server.</>,
    tsEaccesConfirm: <><strong>Confirm the StorageClass backend first</strong>, then decide how to fix:</>,
    tsEaccesBullet1: <>Returns <code>cluster.local/nfs-subdir-external-provisioner</code> — this is the installer's own provisioner, which <code>mkdir 0777</code>s subdirectories, so this normally doesn't happen; if it still errors, check the actual NFS server permissions.</>,
    tsEaccesBullet2: <>Returns <code>nfs.csi.k8s.io</code> (or another CSI driver such as SFS) — apply the{' '}<code>mountPermissions: "0777"</code> fix above.</>,
    tsEaccesPitfall: <><strong>Common pitfall</strong>: the installer's NFS provisioner step has a "<strong>skip if a StorageClass of the same name already exists</strong>" check (see <code>install_nfs_provisioner</code>). If a StorageClass named{' '}<code>NFS_STORAGE_CLASS</code> (default <code>nfs-nap</code>) already exists before install and is backed by <code>nfs.csi.k8s.io</code> / SFS,
          the installer <strong>silently skips</strong> and does not deploy the bundled nfs-subdir provisioner, so agent workspaces land on a 0755 backend and hit this error.
          In that case <code>kubectl get deploy -n $NAMESPACE nfs-subdir-external-provisioner</code> returns NotFound.
          Fix either way: add <code>mountPermissions: "0777"</code> to that SC (as above), or delete the pre-existing SC / use a different <code>NFS_STORAGE_CLASS</code> name and re-run the installer so nfs-subdir actually installs.</>,
    tsVideoH2: 'Agent Browser live view doesn\'t render',
    tsVideoP: <>Usually TURN is unreachable. Set <code>TURN_HOST</code> to an IP the user's browser can actually reach and re-run{' '}<code>install.sh</code>; the full checklist is in <a href="/self-host/sandbox-browser/">Code Sandbox / Agent Browser</a> → Debugging.</>,
  },
  'zh-CN': {
    // Overview
    ovCapH2: '一次安装能得到什么',
    ovIntro: (
      <>
        同一条 <code>./install.sh</code> 既支持联网安装（镜像来自公共仓库），也支持完全隔离网络（镜像来自你自己的仓库）—— 两条路径都在「安装」标签页。它会装出：
      </>
    ),
    ovCoreH3: '核心平台（始终安装）',
    ovCoreControl: <><strong>Control plane</strong> — Agent 管理、调度、用户与 Workspace 管理</>,
    ovCoreGateway: <><strong>Channel gateway</strong> — 外部事件（webhook、Slack 等）到达 Agent 的入口</>,
    ovCoreData: <><strong>数据层</strong> — PostgreSQL（CloudNativePG）+ 共享 NFS</>,
    ovCoreRuntime: <><strong>Agent Workspace 运行时</strong> — 每个 Workspace 一个 pod 运行 Agent；Agent 之间可以互相 <code>@</code>、共享文件并共用记忆存储</>,
    ovOptH3: '可选模块（默认关闭）',
    ovOptSandbox: <><strong>Code Sandbox</strong> — 让 Agent 运行代码并提供临时 web 预览。由第三方 <a href="https://github.com/alibaba/OpenSandbox">OpenSandbox</a> 提供能力，需自行安装；平台通过 <code>OPENSANDBOX_URL</code> 指向它</>,
    ovOptBrowser: <><strong>Agent Browser</strong> — 自托管的 browser as a service：Agent 驱动真实浏览器，用户通过 WebRTC 实时观看。内置 TURN 中继（coturn）和已发布的有头 Chromium 镜像</>,
    ovOptLdap: <><strong>LDAP</strong> — 让用户用 LDAP 账号登录</>,
    ovPrereqH2: '前置条件',
    ovInfraH3: '基础设施',
    ovThResource: '资源',
    ovThRequirement: '要求',
    ovThNotes: '说明',
    ovK8s: 'Kubernetes',
    ovK8sReq: 'v1.28+（多节点），或单个 k3s 节点（single-node profile）',
    ovK8sNote: '推荐 3 个及以上 worker',
    ovWorkers: 'Worker 节点',
    ovWorkersReq: '至少 4 vCPU / 8GB 内存',
    ovWorkersNote: 'Agent pod 按 Workspace 动态创建',
    ovRegAccess: '容器镜像仓库',
    ovRegAccessReq: <>一个所有节点都能拉取的仓库 —— 公共仓库（联网）或你自己的私有仓库（隔离网络）</>,
    ovRegAccessNote: <>把 <code>REGISTRY</code> 指向它；仓库需要登录时填写 <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code></>,
    ovRwx: 'RWX 共享存储',
    ovRwxReq: '支持 ReadWriteMany 的 CSI（最常见的是 NFS）',
    ovRwxNote: '承载 AFS 共享目录，默认 500Gi',
    ovRwo: 'RWO 卷存储',
    ovRwoReq: '任何能运行 PostgreSQL 的 CSI（Ceph RBD、vSAN 等；同一套 NFS 也可以）',
    ovRwoNote: 'PostgreSQL 数据卷 + Agent Workspace 容器磁盘',
    ovNetH3: '网络',
    ovThItem: '项目',
    ovNodeIp: '节点 IP',
    ovNodeIpReq: '至少一个用户可达的 worker IP（NodePort 会用到）',
    ovNodePort: 'NodePort',
    ovNodePortReq: <>30000–32767 范围内的空闲端口：<code>NAP_NODE_PORT</code>；启用对应可选模块时还需 <code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code></>,
    ovTurnPorts: 'TURN 端口',
    ovTurnPortsReq: <>启用 Agent Browser 的 TURN 中继时：在 coturn 节点上开放 <code>3478/tcp+udp</code> 和 <code>49152-49252/udp</code></>,
    ovStorageReach: '存储可达性',
    ovStorageReachReq: '所有节点都能挂载上面两个 storage class（NFS / 块存储 CSI 等）',
    ovRegReach: '仓库可达性',
    ovRegReachReq: '所有节点都能从上面那个仓库拉取镜像（公共仓库，或你的私有仓库）',
    ovLlmH3: 'LLM API',
    ovLlmIntro: '平台不内置任何模型。根据启用的 Agent 类型，你需要提供协议兼容的 API endpoint：',
    ovThAgentType: 'Agent 类型',
    ovThApiProto: '所需 API 协议',
    ovCodexProto: <>OpenAI <strong>Responses API</strong>（注意：不是 Chat Completions）</>,
    ovClaudeProto: 'Anthropic API',
    ovGooseProto: <>OpenAI <strong>Chat Completions API</strong></>,
    ovLlmNote: <>如果你现有的模型服务只支持 <strong>OpenAI Chat Completions API</strong>，Goose Agent 可以直接使用；若还想运行 Claude Code 类 Agent，可在其前面加一个把 OpenAI Chat 协议转成 Anthropic 协议的转换代理。</>,
    ovKubeH3: 'kubeconfig 权限',
    ovKubeP1: <>安装需要 <strong>cluster-admin</strong> — <code>install.sh</code> 会操作命名空间级管理员无法操作的资源（CRD、webhook、ClusterRole、StorageClass 等）。安装完成后可立即回收该权限；稳态运行时，control plane 通过它自己的集群内 ServiceAccount 鉴权，权限范围收得很紧（命名空间内的常规读写 + 仅对 <code>nodes</code> 的集群级 get/list）。</>,
    ovKubeP2: <>操作者的 kubeconfig 永远不会挂载进任何平台 pod。如果无法接受临时的 cluster-admin，这里给出一个等价的最小 ClusterRole。</>,
    ovClusterRoleSummary: '等价的最小 ClusterRole',
    ovClusterRoleNote: <>实际上这仍然接近 cluster-admin（在 core/apps/batch 这几个组上是 <code>*/*</code>），但把资源逐项列出来会让安全评审更容易。</>,
    ovCtaIntro: '前置条件就绪后：',
    ovCtaStart: '开始配置 →',
    ovCtaSkip: '已有 values.env — 直接去安装',
    // Configure
    cfgIntro: (
      <>
        按你的环境填写表单；右侧会实时预览 <code>values.env</code>。所有处理都在本地完成 — <strong>不会上传任何内容</strong>。密钥用{' '}
        <code>crypto.getRandomValues</code> 生成（等价于{' '}
        <code>openssl rand -hex 32</code>）。<strong>机器内部密钥一旦设定，升级时不要改动</strong> — 否则已签发的会话 token 和现有数据库都会失效。
      </>
    ),
    cfgPrintNote: <>交互式配置生成器在线地址为 <a href="https://nap.docs.neutree.ai/self-host/#configure">nap.docs.neutree.ai/self-host/#configure</a>。完整字段文档见 <code>self-host/values.env.example</code>。</>,
    // Install
    inToolsH2: '操作者机器上的工具',
    inToolsIntro: '运行安装器的主机（与集群节点不同）需要：',
    inToolKubectl: <><code>kubectl</code> — 与目标集群兼容的版本</>,
    inToolEnvsubst: <><code>envsubst</code> — 通常随 <code>gettext</code> 包一起提供</>,
    inToolOpenssl: <><code>openssl</code> — 被 <code>gen-secrets.sh</code> 用来生成随机密钥</>,
    inToolHelm: <><code>helm</code> 3.x — 仅当集群尚未有 NFS provisioner 时需要；由 <code>install.sh</code> 的前置阶段调用</>,
    inToolLoader: <><code>docker</code> 或 <code>nerdctl</code> — 供 <code>offline/load-images.sh</code> 把镜像包推入你的仓库（仅隔离网络安装需要）</>,
    inToolsNote: <>集群节点（而非操作者机器）必须能从你的 <code>REGISTRY</code> 拉取镜像。联网时是公共仓库（<code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>）；隔离网络时是你自己的仓库，节点完全不碰公网。</>,
    inQuickH2: '快速开始',
    inQuickAfter: <>完成后打开 <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code>，用 <code>values.env</code> 里的管理员用户名 / 密码登录。</>,
    inQuickAltP: <>也可以不 clone —— 引导脚本会自行下载安装器并作用于当前 kubeconfig。有两件事无法自动探测，需要显式指明：用户访问平台的主机名，以及 RWX 存储（外部 NFS 导出，或集群中已有的支持 RWX 的 StorageClass）：</>,
    inQuickAltNote: <>这会按默认值安装完整 profile；加 <code>--prepare-only</code> 可先检查 <code>/opt/nap/values.env</code>，再去掉该参数重新执行。</>,
    inStepsH2: '分步操作',
    inStep1H3: '获取安装器',
    inStep1Note: <>联网安装时，所有第一方镜像都从公共仓库拉取（<code>${'{'}REGISTRY{'}'}</code>，默认 <code>ghcr.io/neutree-ai/agent-platform</code>）。仅当你把镜像放到别处镜像源时才覆盖 <code>REGISTRY</code>。</>,
    agInstallSummary: '构建镜像包并推入你的仓库',
    agInstall1: <>在一台联网机器上，<code>./offline/save-images.sh</code> 会拉取全部第一方与前置镜像，产出 <code>offline/nap-images.tar.gz</code> 以及 <code>prereqs/</code> 下的前置 chart。把它拷到隔离侧，再用 <code>./offline/load-images.sh --registry &lt;你的仓库&gt;</code>（纯 HTTP 仓库加 <code>--insecure-registry</code>）加载、重打 tag 并把所有镜像推入你的仓库，同时打印出需要粘贴进 <code>values.env</code> 的 <code>REGISTRY=</code> / <code>*_IMAGE=</code> 各行。若厂商已交付预构建镜像包，跳过 <code>save-images</code>，直接从 <code>load-images</code> 开始。</>,
    agInstall2: <>设好之后，后续步骤与联网时完全一致 —— <code>./install.sh</code> 会自动识别离线前置包，并据 <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> 生成 pull secret。若是单台机器、没有外部仓库，改用 <a href="/zh-cn/self-host/single-node/">单节点 profile</a>。</>,
    agPrefix: <><strong>命名</strong>：每个第一方镜像都带 <code>values.env</code> 里的 <code>APP_PREFIX</code>（默认 <code>nap</code>，即 <code>nap-cp</code>）。它<strong>仅供再分发者使用</strong> —— 非默认前缀要求所有第一方镜像都以该前缀重建在你自己的仓库里；公共仓库只发布 <code>nap-*</code>，安装器会直接拒绝这种组合。沿用其他前缀的再分发版本，用自己的 <code>values.env</code> 构建镜像包，并以 <code>load-images.sh --app-prefix &lt;前缀&gt;</code> 加载，脚本才能找到带前缀的镜像。安装器同样拒绝修改现有安装的前缀。</>,
    inRegAuthNote: <>若你的仓库需要登录，在 <code>values.env</code> 里设置 <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> —— 安装器会据此自动创建 <code>regcred</code> imagePullSecret，并挂到平台、CNPG 与 workspace pod 上。</>,
    inStep2H3: '准备 values.env',
    inStep2GenBtn: '配置生成器',
    inStep2P1Pre: '我们推荐使用',
    inStep2P1Post: '— 在线填写、下载结果，放到 ',
    inStep2P1End: ' 目录下。',
    inStep2Note: <>你也可以在命令行编辑：<code>cp values.env.example values.env</code>，运行 <code>./gen-secrets.sh</code> 填好所有机器内部密钥，再用 <code>vi values.env</code> 设置 <code>NAP_HOST</code>、管理员密码和存储配置。</>,
    inStep3H3: '运行安装器',
    inStep3P: <>首次安装和升级用的是同一条命令；它是幂等的，可以安全地重复运行。它会安装前置组件（CloudNativePG operator 和 NFS subdir provisioner），用你的 <code>values.env</code> 渲染 manifest 并 apply，然后通过一次性 Job 写入管理员用户、OAuth client 和 MCP catalog。<code>nap-cp</code> 在启动时运行 SQL 迁移。</>,
    inStep4H3: '登录',
    inStep4P: <>在浏览器打开 <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code>，用 <code>values.env</code> 里的 <code>ADMIN_USERNAME</code> 和{' '}<code>ADMIN_PASSWORD</code> 登录。</>,
    inSubH2: 'install.sh 子命令',
    inSubIntro: <>用于单独运行各阶段；通常情况下一条 <code>./install.sh</code> 就够了。</>,
    inSingleH2: 'Single-node profile',
    inSingleP: <>单个 k3s 节点 —— 与完整 profile 相同，只是改成 <code>PG_INSTANCES=1</code> 并用集群内 NFS server 提供 RWX 存储（单节点没有外部 NFS）。<strong>联网</strong> 时所有镜像直接从公共仓库拉取。<strong>隔离网络</strong> 时它会启动集群内仓库并用镜像包填充，完全不需要外部仓库。<a href="/zh-cn/self-host/single-node/">单节点页面</a> 完整覆盖两条路径。</>,
    // Upgrade
    upPathH2: '升级',
    upPathP1: <>升级与首次安装用的是同一条命令。先把安装器本身更新到新版本（在 clone 的 repo 里 <code>git pull</code> —— 新的 manifest 随之而来），在现有 <code>values.env</code> 里把 <code>IMAGE_TAG</code> 固定到新的发布 tag（或保持 <code>latest</code>），然后重新运行：</>,
    upPathP2: <><code>install.sh</code> 是幂等的，所以升级路径与首次安装一致。它会重新渲染并重新 apply manifest，并刷新第一方 deployment 以拉取新的镜像 digest。<code>nap-cp</code> 启动时会自动运行 SQL 迁移。</>,
    upCallout: <><strong>不要修改密钥</strong> · 复用首次安装时的 <code>values.env</code>。如果机器内部密钥（例如 <code>JWT_SECRET</code>）发生变化，所有已签发的会话 token 都会失效，现有数据库也将无法访问。</>,
    agUpgradeSummary: '先更新安装器与仓库内容',
    agUpgrade: <>两样都要先更新：在联网机器上重新执行 <code>offline/save-images.sh</code> 构建含新 tag 的镜像包，把新的 <code>self-host/</code> 目录连同镜像包一起拷到隔离侧，用 <code>offline/load-images.sh</code> 推入仓库，再跑同一条 <code>./install.sh</code>。</>,
    // Troubleshoot
    tsErrH2: 'install.sh 失败',
    tsErrIntro: <>先找出未就绪的 deployment（把 <code>$NAMESPACE</code> 替换为{' '}<code>values.env</code> 里的 <code>NAMESPACE</code>，默认 <code>nap</code>）：</>,
    tsErrCommon: '常见原因：',
    tsErrPull: <><strong>镜像拉不下来</strong> → <strong>联网</strong>：确认节点能访问{' '}<code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>。<strong>隔离网络</strong>：确认 <code>load-images.sh</code> 已把镜像包推入你的 <code>REGISTRY</code>，且 <code>REGISTRY_USERNAME</code> / <code>REGISTRY_PASSWORD</code> 已设置 —— 安装器会据此生成 regcred pull secret。纯 HTTP 仓库还需让节点容器运行时将其信任为 insecure。</>,
    tsErrPvc: <><strong>PVC 卡在 Pending</strong> → 运行{' '}<code>kubectl -n $NAMESPACE get pvc</code>，检查 StorageClass 是否存在、其 provisioner 是否健康</>,
    tsErrPg: <><strong>PostgreSQL 起不来</strong> →{' '}<code>kubectl -n $NAMESPACE describe cluster.postgresql.cnpg.io nap-pg</code>；最常见的原因是 <code>PG_STORAGE_CLASS</code> 背后的 CSI 不可写</>,
    tsErrPort: <><strong>NodePort 已被占用</strong> → 修改 <code>NAP_NODE_PORT</code> /{' '}<code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code> 并重新运行{' '}<code>install.sh</code></>,
    tsBlankH2: '登录后白屏 / API 返回 401',
    tsBlankP: <>通常是因为升级时 <code>JWT_SECRET</code> 发生了变化 — 所有已签发 token 都失效了。把 <code>values.env</code> 里的 <code>JWT_SECRET</code>{' '}改回首次安装时的值，并重新运行{' '}<code>./install.sh</code>。</>,
    tsReachH2: '无法访问平台',
    tsReachP: <>浏览器在 <code>http://&lt;NAP_HOST&gt;:&lt;NAP_NODE_PORT&gt;</code> 得不到任何响应。两个常见原因：</>,
    tsReachHost: <><strong><code>NAP_HOST</code> 不可达</strong> — 配置的 IP 不是浏览器能访问到的 worker 节点。设置正确的节点 IP 并重新运行 <code>install.sh</code></>,
    tsReachPort: <><strong>NodePort 未开放</strong> — 节点防火墙拦截了该端口；请让 SRE 开放它</>,
    tsEaccesH2: <>Agent 启动失败：<code>mkdir /workspace/.home/.claude: EACCES</code></>,
    tsEaccesP1: <>Agent 容器以非 root 用户（<code>node</code>，uid 1000）运行，而 <code>/workspace</code> 是挂载的 PVC。
          如果该 PVC 由社区版 <code>nfs.csi.k8s.io</code> 驱动提供，<strong>该驱动默认不会对所分配的子目录执行 chmod</strong>
          （根据其文档，<code>mountPermissions</code> 默认为 <code>0</code>；只有非零时才执行 chmod），所以子目录权限来自 NFS server 默认的 <code>mkdir</code> umask — 通常是 <code>root:root 0755</code>，uid 1000 无法写入。</>,
    tsEaccesVerify: '在 NFS server 上验证：',
    tsEaccesFix: <><strong>修复</strong>：在 StorageClass 的 <code>parameters</code> 中加上 <code>mountPermissions: "0777"</code>（作为字符串），然后删除失败的 PVC，让 control plane 重建它。这只影响新分配的 PV；已有的子目录需要在 NFS server 上手动 <code>chmod 0777</code>。</>,
    tsEaccesConfirm: <><strong>先确认 StorageClass 的后端</strong>，再决定如何修复：</>,
    tsEaccesBullet1: <>返回 <code>cluster.local/nfs-subdir-external-provisioner</code> — 这是安装器自带的 provisioner，会对子目录 <code>mkdir 0777</code>，所以通常不会出现这个问题；如果仍报错，检查 NFS server 上的实际权限。</>,
    tsEaccesBullet2: <>返回 <code>nfs.csi.k8s.io</code>（或 SFS 等其他 CSI 驱动）— 应用上面的{' '}<code>mountPermissions: "0777"</code> 修复。</>,
    tsEaccesPitfall: <><strong>常见坑</strong>：安装器的 NFS provisioner 步骤有一个"<strong>同名 StorageClass 已存在则跳过</strong>"的检查（见 <code>install_nfs_provisioner</code>）。如果安装前就已存在一个名为{' '}<code>NFS_STORAGE_CLASS</code>（默认 <code>nfs-nap</code>）且后端是 <code>nfs.csi.k8s.io</code> / SFS 的 StorageClass，
          安装器会<strong>静默跳过</strong>，不部署自带的 nfs-subdir provisioner，于是 Agent Workspace 落到 0755 的后端上并触发该错误。
          此时 <code>kubectl get deploy -n $NAMESPACE nfs-subdir-external-provisioner</code> 返回 NotFound。
          两种修法皆可：给该 SC 加上 <code>mountPermissions: "0777"</code>（如上），或删除已存在的 SC / 改用一个不同的 <code>NFS_STORAGE_CLASS</code> 名称并重新运行安装器，让 nfs-subdir 真正装上。</>,
    tsVideoH2: 'Agent Browser 实时画面不显示',
    tsVideoP: <>通常是 TURN 不可达。把 <code>TURN_HOST</code> 设为用户浏览器真正能访问到的 IP 并重新运行{' '}<code>install.sh</code>；完整排查清单见 <a href="/zh-cn/self-host/sandbox-browser/">Code Sandbox / Agent Browser</a> 的调试一节。</>,
  },
} as const

function Overview({ onGo, locale = 'en' }: { onGo: (id: TabId) => void; locale?: string }) {
  const t = PANEL_STR[locale as keyof typeof PANEL_STR] ?? PANEL_STR.en
  return (
    <div class="sh-content">
      <section>
        <h2 id="capabilities">{t.ovCapH2}</h2>

        <p class="sh-muted">{t.ovIntro}</p>

        <h3>{t.ovCoreH3}</h3>
        <ul class="sh-bullets">
          <li>{t.ovCoreControl}</li>
          <li>{t.ovCoreGateway}</li>
          <li>{t.ovCoreData}</li>
          <li>{t.ovCoreRuntime}</li>
        </ul>

        <h3>{t.ovOptH3}</h3>
        <ul class="sh-bullets">
          <li>{t.ovOptSandbox}</li>
          <li>{t.ovOptBrowser}</li>
          <li>{t.ovOptLdap}</li>
        </ul>
      </section>

      <section>
        <h2 id="prereqs">{t.ovPrereqH2}</h2>

        <h3>{t.ovInfraH3}</h3>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.ovThResource}</th>
                <th>{t.ovThRequirement}</th>
                <th>{t.ovThNotes}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t.ovK8s}</td>
                <td>{t.ovK8sReq}</td>
                <td>{t.ovK8sNote}</td>
              </tr>
              <tr>
                <td>{t.ovWorkers}</td>
                <td>{t.ovWorkersReq}</td>
                <td>{t.ovWorkersNote}</td>
              </tr>
              <tr>
                <td>{t.ovRegAccess}</td>
                <td>{t.ovRegAccessReq}</td>
                <td>{t.ovRegAccessNote}</td>
              </tr>
              <tr>
                <td>{t.ovRwx}</td>
                <td>{t.ovRwxReq}</td>
                <td>{t.ovRwxNote}</td>
              </tr>
              <tr>
                <td>{t.ovRwo}</td>
                <td>{t.ovRwoReq}</td>
                <td>{t.ovRwoNote}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>{t.ovNetH3}</h3>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.ovThItem}</th>
                <th>{t.ovThRequirement}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t.ovNodeIp}</td>
                <td>{t.ovNodeIpReq}</td>
              </tr>
              <tr>
                <td>{t.ovNodePort}</td>
                <td>{t.ovNodePortReq}</td>
              </tr>
              <tr>
                <td>{t.ovTurnPorts}</td>
                <td>{t.ovTurnPortsReq}</td>
              </tr>
              <tr>
                <td>{t.ovStorageReach}</td>
                <td>{t.ovStorageReachReq}</td>
              </tr>
              <tr>
                <td>{t.ovRegReach}</td>
                <td>{t.ovRegReachReq}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>{t.ovLlmH3}</h3>
        <p>{t.ovLlmIntro}</p>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.ovThAgentType}</th>
                <th>{t.ovThApiProto}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Codex</td>
                <td>{t.ovCodexProto}</td>
              </tr>
              <tr>
                <td>Claude Code</td>
                <td>{t.ovClaudeProto}</td>
              </tr>
              <tr>
                <td>Goose</td>
                <td>{t.ovGooseProto}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="sh-muted">{t.ovLlmNote}</p>

        <h3>{t.ovKubeH3}</h3>
        <p>{t.ovKubeP1}</p>
        <p class="sh-muted">{t.ovKubeP2}</p>

        <details class="sh-details">
          <summary>{t.ovClusterRoleSummary}</summary>
          <CodeBlock lang="yaml" locale={locale}>{`apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: nap-installer
rules:
  - apiGroups: [apiextensions.k8s.io]
    resources: [customresourcedefinitions]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [admissionregistration.k8s.io]
    resources: [validatingwebhookconfigurations, mutatingwebhookconfigurations]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [""]
    resources: [namespaces]
    verbs: [get, list, create, update, patch]
  - apiGroups: [rbac.authorization.k8s.io]
    resources: [clusterroles, clusterrolebindings, roles, rolebindings]
    verbs: [get, list, watch, create, update, patch, delete]
  - apiGroups: [storage.k8s.io]
    resources: [storageclasses]
    verbs: [get, list, create, update, patch]
  - apiGroups: [postgresql.cnpg.io]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [opensandbox.alibaba.com]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: ["", apps, batch, networking.k8s.io, policy]
    resources: ["*"]
    verbs: ["*"]
  - apiGroups: [""]
    resources: [nodes]
    verbs: [get, list, watch]`}</CodeBlock>
          <p class="sh-muted">{t.ovClusterRoleNote}</p>
        </details>
      </section>

      <section class="sh-cta">
        <p>{t.ovCtaIntro}</p>
        <div class="sh-cta-row">
          <button class="sh-primary" onClick={() => onGo('configure')}>
            {t.ovCtaStart}
          </button>
          <button class="sh-secondary" onClick={() => onGo('install')}>
            {t.ovCtaSkip}
          </button>
        </div>
      </section>
    </div>
  )
}

function Configure({ locale = 'en' }: { locale?: string }) {
  const t = PANEL_STR[locale as keyof typeof PANEL_STR] ?? PANEL_STR.en
  return (
    <div class="sh-content sh-content-flush">
      <p class="sh-config-intro">{t.cfgIntro}</p>
      <div data-no-print>
        <ValuesGenerator locale={locale} />
      </div>
      <p class="sh-print-only sh-print-note">{t.cfgPrintNote}</p>
    </div>
  )
}

function Install({ onGo, locale = 'en' }: { onGo: (id: TabId) => void; locale?: string }) {
  const t = PANEL_STR[locale as keyof typeof PANEL_STR] ?? PANEL_STR.en
  return (
    <div class="sh-content">
      <section>
        <h2 id="client-tools">{t.inToolsH2}</h2>
        <p>{t.inToolsIntro}</p>
        <ul class="sh-bullets">
          <li>{t.inToolKubectl}</li>
          <li>{t.inToolEnvsubst}</li>
          <li>{t.inToolOpenssl}</li>
          <li>{t.inToolHelm}</li>
          <li>{t.inToolLoader}</li>
        </ul>
        <p class="sh-muted">{t.inToolsNote}</p>
      </section>

      <section>
        <h2 id="quick-start">{t.inQuickH2}</h2>
        <CodeBlock locale={locale}>{`git clone https://github.com/neutree-ai/agent-platform
cd agent-platform/self-host
cp values.env.example values.env
./gen-secrets.sh                # fills random machine secrets
vi values.env                   # set NAP_HOST, ADMIN_PASSWORD, storage, etc.
./install.sh`}</CodeBlock>
        <p>{t.inQuickAfter}</p>
        <p>{t.inQuickAltP}</p>
        <CodeBlock locale={locale}>{`# with an external NFS server
curl -sfL https://nap.docs.neutree.ai/get.sh \\
  | sh -s -- --k8s --host=<ip-or-hostname> --nfs-server=<ip> --nfs-path=</export/path>

# with an existing RWX StorageClass
curl -sfL https://nap.docs.neutree.ai/get.sh \\
  | sh -s -- --k8s --host=<ip-or-hostname> --storage-class=<rwx-storageclass>`}</CodeBlock>
        <p class="sh-muted">{t.inQuickAltNote}</p>
      </section>

      <section>
        <h2 id="steps">{t.inStepsH2}</h2>
        <ol class="sh-steps">
          <li>
            <h3>{t.inStep1H3}</h3>
            <CodeBlock locale={locale}>{`git clone https://github.com/neutree-ai/agent-platform
cd agent-platform/self-host`}</CodeBlock>
            <p class="sh-muted">{t.inStep1Note}</p>
            <AirgapBlock locale={locale} summary={t.agInstallSummary}>
              <p>{t.agInstall1}</p>
              <p>{t.agInstall2}</p>
              <p>{t.agPrefix}</p>
            </AirgapBlock>
          </li>
          <li>
            <h3>{t.inStep2H3}</h3>
            <p>
              {t.inStep2P1Pre}{' '}
              <button
                class="sh-link-btn"
                onClick={() => onGo('configure')}
              >
                {t.inStep2GenBtn}
              </button>{' '}
              {t.inStep2P1Post}<code>self-host/</code>{t.inStep2P1End}
            </p>
            <p class="sh-muted">{t.inStep2Note}</p>
            <p class="sh-muted">{t.inRegAuthNote}</p>
          </li>
          <li>
            <h3>{t.inStep3H3}</h3>
            <CodeBlock locale={locale}>{`./install.sh`}</CodeBlock>
            <p>{t.inStep3P}</p>
          </li>
          <li>
            <h3>{t.inStep4H3}</h3>
            <p>{t.inStep4P}</p>
          </li>
        </ol>
      </section>

      <section>
        <h2 id="subcommands">{t.inSubH2}</h2>
        <p>{t.inSubIntro}</p>
        <CodeBlock locale={locale}>{`./install.sh                  # full: prereqs + manifests + seed
./install.sh --prereqs-only   # only CNPG operator + NFS provisioner
./install.sh --manifests-only # only render + apply k8s manifests
./install.sh --seed-only      # only seed admin / OAuth clients / MCP (K8s Jobs)
./install.sh --render-only    # render manifests to rendered/ without applying`}</CodeBlock>
      </section>

      <section>
        <h2 id="single-node">{t.inSingleH2}</h2>
        <p>{t.inSingleP}</p>
      </section>
    </div>
  )
}

function Upgrade({ locale = 'en' }: { locale?: string }) {
  const t = PANEL_STR[locale as keyof typeof PANEL_STR] ?? PANEL_STR.en
  return (
    <div class="sh-content">
      <section>
        <h2 id="upgrade-path">{t.upPathH2}</h2>
        <p>{t.upPathP1}</p>
        <CodeBlock locale={locale}>{`./install.sh`}</CodeBlock>
        <p>{t.upPathP2}</p>
        <div class="sh-callout sh-callout-warn">{t.upCallout}</div>
        <AirgapBlock locale={locale} summary={t.agUpgradeSummary}>
          <p>{t.agUpgrade}</p>
        </AirgapBlock>
      </section>
    </div>
  )
}

function Troubleshoot({ locale = 'en' }: { locale?: string }) {
  const t = PANEL_STR[locale as keyof typeof PANEL_STR] ?? PANEL_STR.en
  return (
    <div class="sh-content">
      <section>
        <h2 id="install-error">{t.tsErrH2}</h2>
        <p>{t.tsErrIntro}</p>
        <CodeBlock locale={locale}>{`kubectl -n $NAMESPACE get pods
kubectl -n $NAMESPACE describe pod <not-ready-pod>
kubectl -n $NAMESPACE logs deploy/<deployment>`}</CodeBlock>
        <p>{t.tsErrCommon}</p>
        <ul class="sh-bullets">
          <li>{t.tsErrPull}</li>
          <li>{t.tsErrPvc}</li>
          <li>{t.tsErrPg}</li>
          <li>{t.tsErrPort}</li>
        </ul>
      </section>

      <section>
        <h2 id="login-blank">{t.tsBlankH2}</h2>
        <p>{t.tsBlankP}</p>
      </section>

      <section>
        <h2 id="cannot-reach">{t.tsReachH2}</h2>
        <p>{t.tsReachP}</p>
        <ul class="sh-bullets">
          <li>{t.tsReachHost}</li>
          <li>{t.tsReachPort}</li>
        </ul>
      </section>

      <section>
        <h2 id="agent-workspace-eacces">{t.tsEaccesH2}</h2>
        <p>{t.tsEaccesP1}</p>
        <p>{t.tsEaccesVerify}</p>
        <CodeBlock locale={locale}>{`ls -ld <nfs-share>/pvc-<uuid>
# drwxr-xr-x 1 root root ...   <- 0755, not 0777`}</CodeBlock>
        <p>{t.tsEaccesFix}</p>
        <CodeBlock locale={locale}>{`parameters:
  server: <nfs-server>
  share: <export-path>
  mountPermissions: "0777"`}</CodeBlock>
        <p>{t.tsEaccesConfirm}</p>
        <CodeBlock locale={locale}>{`kubectl get sc <AGENT_STORAGE_CLASS> -o jsonpath='{.provisioner}{"\\n"}'`}</CodeBlock>
        <ul>
          <li>{t.tsEaccesBullet1}</li>
          <li>{t.tsEaccesBullet2}</li>
        </ul>
        <p>{t.tsEaccesPitfall}</p>
      </section>

      <section>
        <h2 id="browser-no-video">{t.tsVideoH2}</h2>
        <p>{t.tsVideoP}</p>
      </section>
    </div>
  )
}
