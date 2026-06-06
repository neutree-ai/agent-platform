import { i18n } from '@/lib/i18n'
import { createContext, useCallback, useContext, useState } from 'react'
import type { ComponentType } from 'react'

// ─── Dialog component contract ──────────────────────────────────────
export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Registry ───────────────────────────────────────────────────────
// Import dialog components lazily to avoid circular deps
// Each dialog must accept { open, onOpenChange } props

// Synchronously loaded dialogs (for those already imported)
const SYNC_REGISTRY: Record<string, ComponentType<DialogProps>> = {}

export function registerDialog(key: string, component: ComponentType<DialogProps>) {
  SYNC_REGISTRY[key] = component
}

type DialogKey = string

// ─── Context ────────────────────────────────────────────────────────
interface DialogStackContextValue {
  open: (key: DialogKey) => void
  close: (key: DialogKey) => void
  isOpen: (key: DialogKey) => boolean
}

const DialogStackContext = createContext<DialogStackContextValue | null>(null)

export function useDialogStack() {
  const ctx = useContext(DialogStackContext)
  if (!ctx) throw new Error(i18n.t('common.errors.dialogStackProviderRequired'))
  return ctx
}

// ─── Provider ───────────────────────────────────────────────────────
export function DialogStackProvider({ children }: { children: React.ReactNode }) {
  const [activeDialogs, setActiveDialogs] = useState<Set<string>>(new Set())

  const openDialog = useCallback((key: DialogKey) => {
    setActiveDialogs((prev) => new Set(prev).add(key))
  }, [])

  const closeDialog = useCallback((key: DialogKey) => {
    setActiveDialogs((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  const isOpen = useCallback((key: DialogKey) => activeDialogs.has(key), [activeDialogs])

  return (
    <DialogStackContext.Provider value={{ open: openDialog, close: closeDialog, isOpen }}>
      {children}
      {Array.from(activeDialogs).map((key) => {
        const Component = SYNC_REGISTRY[key]
        if (!Component) return null
        return (
          <Component
            key={key}
            open
            onOpenChange={(v) => {
              if (!v) closeDialog(key)
            }}
          />
        )
      })}
    </DialogStackContext.Provider>
  )
}
