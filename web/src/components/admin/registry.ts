import type { ComponentType } from 'react'
import { DashboardSection } from './DashboardSection'
import { InfraSection } from './InfraSection'
import { SystemSettingsSection } from './SystemSettingsSection'
import { UsersSection } from './UsersSection'
import { WorkspacesSection } from './WorkspacesSection'

interface AdminSectionProps {
  instanceId: string
}

/**
 * A tab in the admin console. To add a section, append one entry here — the
 * AdminPanel derives its tab bar and body from this list, nothing else changes.
 */
interface AdminSectionDef {
  /**
   * Stable id, persisted in instance state (`adminSection`). Keep it unchanged
   * across label renames so open tabs don't reset to the default section.
   */
  id: string
  /** i18n key for the tab label. */
  labelKey: string
  Component: ComponentType<AdminSectionProps>
}

export const ADMIN_SECTIONS: AdminSectionDef[] = [
  {
    id: 'dashboard',
    labelKey: 'pages.admin.navigation.dashboard',
    Component: DashboardSection,
  },
  {
    id: 'users',
    labelKey: 'pages.admin.navigation.users',
    Component: UsersSection,
  },
  {
    id: 'workspaces',
    labelKey: 'pages.admin.navigation.workspaces',
    Component: WorkspacesSection,
  },
  {
    id: 'infra',
    labelKey: 'pages.admin.navigation.infrastructure',
    Component: InfraSection,
  },
  {
    id: 'system',
    labelKey: 'pages.admin.navigation.system',
    Component: SystemSettingsSection,
  },
]

export const DEFAULT_ADMIN_SECTION = ADMIN_SECTIONS[0].id
