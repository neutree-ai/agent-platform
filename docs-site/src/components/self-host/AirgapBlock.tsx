import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import './airgap-block.css'

// All AirgapBlock instances share one expand/collapse state, remembered across
// pages via localStorage: an air-gapped reader opens one block and every block
// on every self-host page stays open for them.
const STORE_KEY = 'nap-airgap-open'
const SYNC_EVENT = 'nap-airgap-toggle'

const STR = {
  en: { label: 'Air-gapped', hint: 'extra steps for nodes with no internet access' },
  'zh-CN': { label: '隔离网络', hint: '无公网节点的额外步骤' },
} as const

interface Props {
  locale?: string
  /** Optional short summary shown after the label, overriding the default hint. */
  summary?: string
  children?: ComponentChildren
}

export default function AirgapBlock({ locale = 'en', summary, children }: Props) {
  const t = STR[locale as keyof typeof STR] ?? STR.en
  // SSR renders collapsed; the stored preference is applied after hydration.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const apply = () => setOpen(localStorage.getItem(STORE_KEY) === '1')
    apply()
    // Same-page instances sync via the custom event; other tabs via 'storage'.
    window.addEventListener(SYNC_EVENT, apply)
    window.addEventListener('storage', apply)
    return () => {
      window.removeEventListener(SYNC_EVENT, apply)
      window.removeEventListener('storage', apply)
    }
  }, [])

  const toggle = () => {
    localStorage.setItem(STORE_KEY, open ? '0' : '1')
    window.dispatchEvent(new Event(SYNC_EVENT))
  }

  return (
    <div class={`ag-block ${open ? 'ag-open' : ''}`}>
      <button type="button" class="ag-head" aria-expanded={open} onClick={toggle}>
        <svg class="ag-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <strong class="ag-label">{t.label}</strong>
        <span class="ag-hint">{summary ?? t.hint}</span>
        <svg class="ag-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div class="ag-body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
