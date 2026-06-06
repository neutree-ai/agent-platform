import { loadDoc } from './_load'

export function getCommandDoc(): string {
  return loadDoc('command')
}

export function getScheduleDoc(mode: 'recurring' | 'one_time' = 'recurring'): string {
  return loadDoc(mode === 'one_time' ? 'schedule-one-time' : 'schedule-recurring')
}

export function getSandboxDoc(): string {
  return loadDoc('sandbox')
}

export function getBrowserLaunchDoc(): string {
  return loadDoc('browser-launch')
}

export function getTagsDoc(): string {
  return loadDoc('tags')
}

export function getWorkspaceSettingsDoc(): string {
  return loadDoc('workspace-settings')
}
