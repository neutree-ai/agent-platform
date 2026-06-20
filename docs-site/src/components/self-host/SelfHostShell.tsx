import { useEffect, useRef, useState } from 'preact/hooks'
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

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', hint: 'Capabilities & prerequisites' },
  { id: 'configure', label: 'Configure', hint: 'Generate values.env interactively' },
  { id: 'install', label: 'Install', hint: 'Quick start, script, subcommands' },
  { id: 'upgrade', label: 'Upgrade', hint: 'One-command upgrade path' },
  { id: 'troubleshoot', label: 'Troubleshoot', hint: 'Common failures & diagnosis' },
]

function readHashTab(): TabId {
  if (typeof window === 'undefined') return 'overview'
  const h = window.location.hash.replace(/^#/, '') as TabId
  return TABS.some((t) => t.id === h) ? h : 'overview'
}

export default function SelfHostShell() {
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
            <span class="sh-head-eyebrow">Neutree Agent Platform — Self-Host</span>
            <span class="sh-head-tag">Install the platform on your own Kubernetes cluster, pulling images from public registries</span>
          </div>
          <button
            type="button"
            class="sh-print-btn"
            onClick={() => window.print()}
            title="Print all sections together or export to PDF"
            data-no-print
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / Export PDF
          </button>
        </div>
        <nav class="sh-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              class={`sh-tab ${t.id === active ? 'sh-tab-active' : ''}`}
              onClick={() => goto(t.id)}
            >
              <span class="sh-tab-label">{t.label}</span>
              <span class="sh-tab-hint">{t.hint}</span>
            </button>
          ))}
        </nav>
      </header>

      <div class={`sh-body ${hasToc ? 'sh-body-with-toc' : ''}`}>
        <main class="sh-panel" role="tabpanel" ref={panelRef}>
          {active === 'overview' && <Overview onGo={goto} />}
          {active === 'configure' && <Configure />}
          {active === 'install' && <Install onGo={goto} />}
          {active === 'upgrade' && <Upgrade />}
          {active === 'troubleshoot' && <Troubleshoot />}
        </main>

        {hasToc && (
          <aside class="sh-toc" aria-label="On this page">
            <div class="sh-toc-label">On this page</div>
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
        {TABS.map((t) => (
          <section class="sh-print-section" key={t.id}>
            <h1 class="sh-print-h1">{t.label}</h1>
            {t.id === 'overview' && <Overview onGo={() => {}} />}
            {t.id === 'configure' && <Configure />}
            {t.id === 'install' && <Install onGo={() => {}} />}
            {t.id === 'upgrade' && <Upgrade />}
            {t.id === 'troubleshoot' && <Troubleshoot />}
          </section>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function Overview({ onGo }: { onGo: (id: TabId) => void }) {
  return (
    <div class="sh-content">
      <section>
        <h2 id="capabilities">What one install gives you</h2>

        <p class="sh-muted">
          This is the <strong>connected / online</strong> installer: the target cluster must be able to reach the public internet. Images are pulled directly from public registries (<code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>) and prerequisite charts/manifests are fetched from their public sources. There is no offline image bundle, no in-cluster registry, and no host image-loading step. For fully air-gapped sites, a separate offline installer ships an image tarball, an in-cluster registry, and a host-prep step.
        </p>

        <h3>Core platform (always installed)</h3>
        <ul class="sh-bullets">
          <li>
            <strong>Control plane</strong> — agent management, scheduling, user and workspace management
          </li>
          <li>
            <strong>Channel gateway</strong> — the entry point for external events (webhooks, Slack, etc.) to reach agents
          </li>
          <li>
            <strong>Data layer</strong> — PostgreSQL (CloudNativePG) + shared NFS
          </li>
          <li>
            <strong>Agent workspace runtime</strong> — one pod per workspace runs the agent; agents can <code>@</code> each other, share files, and share a memory store
          </li>
        </ul>

        <h3>Optional modules (off by default)</h3>
        <ul class="sh-bullets">
          <li>
            <strong>Code Sandbox</strong> — lets agents run code and serve temporary web previews. Powered by the third-party <a href="https://github.com/alibaba/OpenSandbox">OpenSandbox</a>, which you install yourself; the platform points at it via <code>OPENSANDBOX_URL</code>
          </li>
          <li>
            <strong>Remote Browser</strong> — lets agents drive a real browser while users watch live over WebRTC. Ships a bundled TURN relay (coturn) and a published headful Chromium image
          </li>
          <li>
            <strong>LDAP</strong> — let users sign in with their LDAP account
          </li>
        </ul>
      </section>

      <section>
        <h2 id="prereqs">Prerequisites</h2>

        <h3>Infrastructure</h3>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Requirement</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Kubernetes</td>
                <td>v1.28+ (multi-node), or a single k3s node (single-node profile)</td>
                <td>3+ workers recommended</td>
              </tr>
              <tr>
                <td>Worker nodes</td>
                <td>4 vCPU / 8GB RAM minimum</td>
                <td>Agent pods are created per workspace dynamically</td>
              </tr>
              <tr>
                <td>Public registry access</td>
                <td>Nodes can pull from <code>ghcr.io</code>, <code>docker.io</code>, <code>registry.k8s.io</code></td>
                <td>Override <code>REGISTRY</code> only to use a mirror</td>
              </tr>
              <tr>
                <td>RWX shared storage</td>
                <td>A CSI that supports ReadWriteMany (NFS is the most common)</td>
                <td>Backs the AFS shared directory, 500Gi by default</td>
              </tr>
              <tr>
                <td>RWO volume storage</td>
                <td>Any CSI that can run PostgreSQL (Ceph RBD, vSAN, etc.; the same NFS also works)</td>
                <td>PostgreSQL data volumes + agent workspace container disks</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Network</h3>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Requirement</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Node IP</td>
                <td>At least one worker IP reachable by users (NodePort uses it)</td>
              </tr>
              <tr>
                <td>NodePort</td>
                <td>
                  3 free ports in 30000–32767: <code>TOS_NODE_PORT</code> / <code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code>
                </td>
              </tr>
              <tr>
                <td>TURN ports</td>
                <td>
                  When the Remote Browser's TURN relay is enabled: open <code>3478/tcp+udp</code> and <code>49152-49252/udp</code> on the coturn node
                </td>
              </tr>
              <tr>
                <td>Storage reachability</td>
                <td>All nodes can mount the two storage classes above (NFS / block-storage CSI, etc.)</td>
              </tr>
              <tr>
                <td>Registry reachability</td>
                <td>All nodes can pull images from the public registries</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>LLM API</h3>
        <p>
          The platform does not bundle any model. Depending on the agent types you enable, you must provide protocol-compatible API endpoints:
        </p>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent type</th>
                <th>API protocol required</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Codex</td>
                <td>OpenAI <strong>Responses API</strong> (note: not Chat Completions)</td>
              </tr>
              <tr>
                <td>Claude Code</td>
                <td>Anthropic API</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="sh-muted">
          If your existing model service only supports the <strong>OpenAI Chat Completions API</strong>, one option is to put a translating proxy in front of it that converts the OpenAI Chat protocol to the Anthropic protocol, then point Claude Code-style agents at the proxy.
        </p>

        <h3>kubeconfig permissions</h3>
        <p>
          Installation requires <strong>cluster-admin</strong> — <code>install.sh</code> touches resources that a namespace-scoped admin cannot (CRDs, webhooks, ClusterRoles, StorageClasses, etc.). You can revoke it immediately after install; at steady state the control plane authenticates via its own in-cluster ServiceAccount with tightly scoped permissions (normal read/write within the namespace + cluster-scoped get/list on <code>nodes</code> only).
        </p>
        <p class="sh-muted">
          The operator's kubeconfig is never mounted into any platform pod. If a temporary cluster-admin is not acceptable, here is an equivalent minimal ClusterRole.
        </p>

        <details class="sh-details">
          <summary>Equivalent minimal ClusterRole</summary>
          <CodeBlock lang="yaml">{`apiVersion: rbac.authorization.k8s.io/v1
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
          <p class="sh-muted">
            This is still close to cluster-admin in practice (<code>*/*</code> on the core/apps/batch groups), but spelling out the resources makes a security review easier.
          </p>
        </details>
      </section>

      <section class="sh-cta">
        <p>Once the prerequisites are in place:</p>
        <div class="sh-cta-row">
          <button class="sh-primary" onClick={() => onGo('configure')}>
            Start configuring →
          </button>
          <button class="sh-secondary" onClick={() => onGo('install')}>
            Already have values.env — go to install
          </button>
        </div>
      </section>
    </div>
  )
}

function Configure() {
  return (
    <div class="sh-content sh-content-flush">
      <p class="sh-config-intro">
        Fill in the form for your environment; <code>values.env</code> is previewed live on the right. Everything is processed locally — <strong>nothing is uploaded</strong>. Secrets are generated with{' '}
        <code>crypto.getRandomValues</code> (equivalent to{' '}
        <code>openssl rand -hex 32</code>). <strong>Once a machine-internal secret is set, do not change it on upgrade</strong> — otherwise issued session tokens and the existing database become unusable.
      </p>
      <div data-no-print>
        <ValuesGenerator />
      </div>
      <p class="sh-print-only sh-print-note">
        The interactive configuration generator is online at <a href="https://nap.docs.neutree.ai/self-host/#configure">nap.docs.neutree.ai/self-host/#configure</a>. For full field documentation see <code>self-host/values.env.example</code>.
      </p>
    </div>
  )
}

function Install({ onGo }: { onGo: (id: TabId) => void }) {
  return (
    <div class="sh-content">
      <section>
        <h2 id="client-tools">Tools on the operator machine</h2>
        <p>
          The host running the installer (distinct from the cluster nodes) needs:
        </p>
        <ul class="sh-bullets">
          <li>
            <code>kubectl</code> — a version compatible with the target cluster
          </li>
          <li>
            <code>envsubst</code> — usually shipped with the <code>gettext</code> package
          </li>
          <li>
            <code>openssl</code> — used by <code>gen-secrets.sh</code> to generate random secrets
          </li>
          <li>
            <code>helm</code> 3.x — only needed when the cluster doesn't already have an NFS provisioner; invoked by <code>install.sh</code>'s prerequisites stage
          </li>
        </ul>
        <p class="sh-muted">
          The cluster nodes (not the operator machine) must be able to pull from <code>ghcr.io</code>, <code>docker.io</code>, and <code>registry.k8s.io</code>.
        </p>
      </section>

      <section>
        <h2 id="quick-start">Quick start</h2>
        <CodeBlock>{`git clone <this-repo> && cd self-host
cp values.env.example values.env
./gen-secrets.sh                # fills random machine secrets
vi values.env                   # set TOS_HOST, ADMIN_PASSWORD, storage, etc.
./install.sh`}</CodeBlock>
        <p>
          When it finishes, open <code>http://&lt;TOS_HOST&gt;:&lt;TOS_NODE_PORT&gt;</code> and log in with the admin username / password from <code>values.env</code>.
        </p>
      </section>

      <section>
        <h2 id="steps">Step by step</h2>
        <ol class="sh-steps">
          <li>
            <h3>Get the installer</h3>
            <CodeBlock>{`git clone <this-repo> && cd self-host`}</CodeBlock>
            <p class="sh-muted">
              All first-party images are pulled from the public registry (<code>${'{'}REGISTRY{'}'}</code>, default <code>ghcr.io/neutree-ai/agent-platform</code>); there is no image tarball to load. Override <code>REGISTRY</code> only if you mirror the images elsewhere.
            </p>
          </li>
          <li>
            <h3>Prepare values.env</h3>
            <p>
              We recommend the{' '}
              <button
                class="sh-link-btn"
                onClick={() => onGo('configure')}
              >
                configuration generator
              </button>{' '}
              — fill it in online, download the result, and place it in the <code>self-host/</code> directory.
            </p>
            <p class="sh-muted">
              You can also edit it on the command line: <code>cp values.env.example values.env</code>, run <code>./gen-secrets.sh</code> to fill all machine-internal secrets, then <code>vi values.env</code> to set <code>TOS_HOST</code>, the admin password, and storage settings.
            </p>
          </li>
          <li>
            <h3>Run the installer</h3>
            <CodeBlock>{`./install.sh`}</CodeBlock>
            <p>
              The same command serves first-time install and upgrade; it is idempotent and safe to re-run. It installs prerequisites (the CloudNativePG operator and the NFS subdir provisioner), renders the manifests with your <code>values.env</code> and applies them, then seeds the admin user, OAuth clients, and the MCP catalog via one-shot Jobs. <code>nap-cp</code> runs SQL migrations on startup.
            </p>
          </li>
          <li>
            <h3>Log in</h3>
            <p>
              Open <code>http://&lt;TOS_HOST&gt;:&lt;TOS_NODE_PORT&gt;</code> in a browser and log in with <code>ADMIN_USERNAME</code> and the <code>ADMIN_PASSWORD</code> from{' '}
              <code>values.env</code>.
            </p>
          </li>
        </ol>
      </section>

      <section>
        <h2 id="subcommands">install.sh subcommands</h2>
        <p>For running stages separately; a single <code>./install.sh</code> is enough for the normal case.</p>
        <CodeBlock>{`./install.sh                  # full: prereqs + manifests + seed
./install.sh --prereqs-only   # only CNPG operator + NFS provisioner
./install.sh --manifests-only # only render + apply k8s manifests
./install.sh --seed-only      # only seed admin / OAuth clients / MCP (K8s Jobs)
./install.sh --render-only    # render manifests to rendered/ without applying`}</CodeBlock>
      </section>

      <section>
        <h2 id="single-node">Single-node profile</h2>
        <p>
          A single k3s node that pulls every image straight from the public registry — same as the full profile, just with <code>PG_INSTANCES=1</code> and an in-cluster NFS server for RWX storage (a single node has no external NFS). It does not bring up an in-cluster registry and does not load any tarball.
        </p>
        <CodeBlock>{`cp values.env.single-node.example values.env
./gen-secrets.sh
vi values.env                 # set TOS_HOST + ADMIN_PASSWORD
./install.sh --profile=single-node`}</CodeBlock>
        <p class="sh-muted">
          Run this on a host that has a working k3s with its kubeconfig at <code>/etc/rancher/k3s/k3s.yaml</code> (the default in the single-node example).
        </p>
      </section>

      <section>
        <h2 id="offline">Air-gapped sites</h2>
        <p class="sh-muted">
          This page documents the connected installer. For fully air-gapped / offline sites there is a separate offline installer that ships an image tarball, an in-cluster registry, and a host image-loading step.
        </p>
      </section>
    </div>
  )
}

function Upgrade() {
  return (
    <div class="sh-content">
      <section>
        <h2 id="upgrade-path">Upgrade</h2>
        <p>
          Upgrading is the same command as a first install. Pin <code>IMAGE_TAG</code> to the new release tag (or keep <code>latest</code>) in your existing <code>values.env</code>, then re-run:
        </p>
        <CodeBlock>{`./install.sh`}</CodeBlock>
        <p>
          <code>install.sh</code> is idempotent, so the upgrade path matches the first install. It re-renders and re-applies the manifests and refreshes the first-party deployments to pick up new image digests. SQL migrations run automatically when <code>nap-cp</code> starts.
        </p>
        <div class="sh-callout sh-callout-warn">
          <strong>Do not change secrets</strong> · Reuse the <code>values.env</code> from your first install. If a machine-internal secret (e.g. <code>JWT_SECRET</code>) changes, all issued session tokens are invalidated and the existing database can no longer be reached.
        </div>
      </section>

      <section>
        <h2 id="compat">Upgrading from a pre-2026-05 release</h2>
        <p>Optional-module defaults changed from "enabled unless configured" to "disabled unless configured". If the following <code>_ENABLED</code> fields aren't set explicitly in <code>values.env</code>, the corresponding capabilities are off after the upgrade:</p>
        <div class="sh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Capability</th>
                <th>Old default</th>
                <th>New default</th>
                <th>Keep it on with</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Remote Browser (incl. TURN)</td>
                <td>On</td>
                <td>Off</td>
                <td><code>BROWSER_ENABLED=true</code></td>
              </tr>
              <tr>
                <td>Code Sandbox</td>
                <td>On</td>
                <td>Off</td>
                <td><code>SANDBOX_ENABLED=true</code></td>
              </tr>
              <tr>
                <td>LDAP login</td>
                <td>Whether <code>LDAP_URL</code> is non-empty</td>
                <td>Off</td>
                <td><code>LDAP_ENABLED=true</code></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="sh-muted">
          <code>COTURN_ENABLED</code> is now part of the browser module and tracks <code>BROWSER_ENABLED</code> automatically — no separate configuration.
        </p>
      </section>
    </div>
  )
}

function Troubleshoot() {
  return (
    <div class="sh-content">
      <section>
        <h2 id="install-error">install.sh fails</h2>
        <p>
          First find the deployment that isn't ready (replace <code>$NAMESPACE</code> with{' '}
          <code>NAMESPACE</code> from <code>values.env</code>, default <code>nap</code>):
        </p>
        <CodeBlock>{`kubectl -n $NAMESPACE get pods
kubectl -n $NAMESPACE describe pod <not-ready-pod>
kubectl -n $NAMESPACE logs deploy/<deployment>`}</CodeBlock>
        <p>Common causes:</p>
        <ul class="sh-bullets">
          <li>
            <strong>Images won't pull</strong> → confirm the nodes can reach{' '}
            <code>ghcr.io</code> / <code>docker.io</code> / <code>registry.k8s.io</code>. If you mirror images, check <code>REGISTRY</code> and the <code>IMAGE_PULL_SECRET</code> you configured.
          </li>
          <li>
            <strong>PVCs stuck Pending</strong> → run{' '}
            <code>kubectl -n $NAMESPACE get pvc</code> and check the StorageClass exists and its provisioner is healthy
          </li>
          <li>
            <strong>PostgreSQL won't start</strong> →{' '}
            <code>kubectl -n $NAMESPACE describe cluster.postgresql.cnpg.io nap-pg</code>; the most common cause is the CSI behind <code>PG_STORAGE_CLASS</code> not being writable
          </li>
          <li>
            <strong>NodePort already in use</strong> → change <code>TOS_NODE_PORT</code> /{' '}
            <code>BROWSER_NODE_PORT</code> / <code>SANDBOX_NODE_PORT</code> and re-run{' '}
            <code>install.sh</code>
          </li>
        </ul>
      </section>

      <section>
        <h2 id="login-blank">Blank page after login / APIs return 401</h2>
        <p>
          Usually because <code>JWT_SECRET</code> changed during an upgrade — all issued tokens are invalidated. Roll <code>JWT_SECRET</code> in{' '}
          <code>values.env</code> back to its first-install value and re-run{' '}
          <code>./install.sh</code>.
        </p>
      </section>

      <section>
        <h2 id="cannot-reach">Cannot reach the platform</h2>
        <p>
          The browser gets no response at <code>http://&lt;TOS_HOST&gt;:&lt;TOS_NODE_PORT&gt;</code>. Two common causes:
        </p>
        <ul class="sh-bullets">
          <li>
            <strong><code>TOS_HOST</code> is unreachable</strong> — the configured IP is not a worker node reachable from the browser. Set the correct node IP and re-run <code>install.sh</code>
          </li>
          <li>
            <strong>NodePort not open</strong> — the node firewall blocks the port; ask your SRE to open it
          </li>
        </ul>
      </section>

      <section>
        <h2 id="capability-gone">Browser / Sandbox missing after upgrade</h2>
        <p>
          Optional-module defaults changed to "disabled unless configured" as of 2026-05. If you previously enabled the browser or sandbox, set{' '}
          <code>BROWSER_ENABLED=true</code> / <code>SANDBOX_ENABLED=true</code> explicitly in{' '}
          <code>values.env</code>. See the compatibility section on the Upgrade tab.
        </p>
      </section>

      <section>
        <h2 id="agent-workspace-eacces">Agent fails to start: <code>mkdir /workspace/.home/.claude: EACCES</code></h2>
        <p>
          The agent container runs as a non-root user (<code>node</code>, uid 1000), and <code>/workspace</code> is a mounted PVC.
          If that PVC is backed by the community <code>nfs.csi.k8s.io</code> driver, <strong>that driver does not chmod the provisioned subdirectory by default</strong>
          (per its docs, <code>mountPermissions</code> defaults to <code>0</code>; chmod only runs when non-zero), so subdirectory permissions come from the NFS server's default <code>mkdir</code> umask — typically <code>root:root 0755</code>, which uid 1000 cannot write to.
        </p>
        <p>Verify on the NFS server:</p>
        <CodeBlock>{`ls -ld <nfs-share>/pvc-<uuid>
# drwxr-xr-x 1 root root ...   <- 0755, not 0777`}</CodeBlock>
        <p>
          <strong>Fix</strong>: add <code>mountPermissions: "0777"</code> (as a string) to the StorageClass <code>parameters</code>, then delete the failed PVC and let the control plane recreate it. This only affects newly provisioned PVs; existing subdirectories need a manual <code>chmod 0777</code> on the NFS server.
        </p>
        <CodeBlock>{`parameters:
  server: <nfs-server>
  share: <export-path>
  mountPermissions: "0777"`}</CodeBlock>
        <p>
          <strong>Confirm the StorageClass backend first</strong>, then decide how to fix:
        </p>
        <CodeBlock>{`kubectl get sc <AGENT_STORAGE_CLASS> -o jsonpath='{.provisioner}{"\\n"}'`}</CodeBlock>
        <ul>
          <li>
            Returns <code>cluster.local/nfs-subdir-external-provisioner</code> — this is the installer's own provisioner, which <code>mkdir 0777</code>s subdirectories, so this normally doesn't happen; if it still errors, check the actual NFS server permissions.
          </li>
          <li>
            Returns <code>nfs.csi.k8s.io</code> (or another CSI driver such as SFS) — apply the{' '}
            <code>mountPermissions: "0777"</code> fix above.
          </li>
        </ul>
        <p>
          <strong>Common pitfall</strong>: the installer's NFS provisioner step has a "<strong>skip if a StorageClass of the same name already exists</strong>" check (see <code>install_nfs_provisioner</code>). If a StorageClass named{' '}
          <code>NFS_STORAGE_CLASS</code> (default <code>nfs-nap</code>) already exists before install and is backed by <code>nfs.csi.k8s.io</code> / SFS,
          the installer <strong>silently skips</strong> and does not deploy the bundled nfs-subdir provisioner, so agent workspaces land on a 0755 backend and hit this error.
          In that case <code>kubectl get deploy -n nap nfs-subdir-external-provisioner</code> returns NotFound.
          Fix either way: add <code>mountPermissions: "0777"</code> to that SC (as above), or delete the pre-existing SC / use a different <code>NFS_STORAGE_CLASS</code> name and re-run the installer so nfs-subdir actually installs.
        </p>
      </section>

      <section>
        <h2 id="browser-no-video">Browser live view doesn't render</h2>
        <p>
          Enable Remote Browser in the configuration generator, set{' '}
          <code>TURN_HOST</code> (a LAN or public IP browsers can reach) and{' '}
          <code>TURN_AUTH_SECRET</code>, and re-run{' '}
          <code>install.sh</code>. The TURN relay is bundled with the browser and starts/stops together with it.
        </p>
      </section>
    </div>
  )
}
