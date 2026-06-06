import type { SlotConfig } from '@/contexts/SlotContext'
import { Columns2, Columns3, type LucideIcon, Square } from 'lucide-react'
import type { ComponentType } from 'react'
import { ONE_COLUMN_SLOTS, OneColumnLayout } from './OneColumnLayout'
import { THREE_COLUMN_SLOTS, ThreeColumnLayout } from './ThreeColumnLayout'
import { TWO_COLUMN_SLOTS, TwoColumnLayoutDefault } from './TwoColumnLayout'

export type LayoutId = '1col' | '2col' | '3col'

interface LayoutDef {
  id: LayoutId
  slots: SlotConfig[]
  Component: ComponentType
  icon: LucideIcon
  labelKey: string
  /**
   * Where an unmatched app lands when `ensureInstance` falls back (i.e. the
   * app isn't already opened in any slot and isn't listed in any slot's
   * `defaultOpened`). Chosen per layout so the user's anchor slot (sessions
   * sidebar / chat column) isn't pushed aside by ⌘K launches:
   *   - 1col / 2col → the only / leading work slot (slot-a)
   *   - 3col       → the tools column (slot-b), keeping sessions + chat intact
   */
  fallbackSlotId: string
}

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  '1col': {
    id: '1col',
    slots: ONE_COLUMN_SLOTS,
    Component: OneColumnLayout,
    icon: Square,
    labelKey: 'components.shell.layout.oneCol',
    fallbackSlotId: 'slot-a',
  },
  '2col': {
    id: '2col',
    slots: TWO_COLUMN_SLOTS,
    Component: TwoColumnLayoutDefault,
    icon: Columns2,
    labelKey: 'components.shell.layout.twoCol',
    fallbackSlotId: 'slot-a',
  },
  '3col': {
    id: '3col',
    slots: THREE_COLUMN_SLOTS,
    Component: ThreeColumnLayout,
    icon: Columns3,
    labelKey: 'components.shell.layout.threeCol',
    fallbackSlotId: 'slot-b',
  },
}

/**
 * Resolves which slot should host an unmatched app for the given layout.
 * Used by `ensureInstance` so SlotContext doesn't need per-layout knowledge.
 */
export function getFallbackSlotId(layoutId: LayoutId): string {
  return LAYOUTS[layoutId].fallbackSlotId
}

export const LAYOUT_IDS: LayoutId[] = ['1col', '2col', '3col']
export const DEFAULT_LAYOUT: LayoutId = '3col'

/**
 * Fleet scope only offers 1col / 2col — no chat sidecar to justify a third
 * column. 2col is the historical default (launcher + Activity sidecar).
 */
export const FLEET_LAYOUT_IDS: LayoutId[] = ['1col', '2col']
export const FLEET_DEFAULT_LAYOUT: LayoutId = '2col'

export function isLayoutId(v: string | null): v is LayoutId {
  return v === '1col' || v === '2col' || v === '3col'
}
