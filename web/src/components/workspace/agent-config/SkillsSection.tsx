import { SkillPicker } from '../SkillPicker'

interface SkillsSectionProps {
  workspaceId: string
  /** Workspace-enabled skill UUIDs (p3). */
  enabledSkills: Set<string>
  onToggle: (id: string) => void
  /** Template baseline (UUIDs). `null` when the workspace isn't templated. */
  templateConfig?: { skill_ids: string[] } | null
}

export function SkillsSection({ enabledSkills, onToggle, templateConfig }: SkillsSectionProps) {
  const value = [...enabledSkills]

  function handleChange(ids: string[]) {
    const next = new Set(ids)
    // Toggle off skills that were removed
    for (const id of enabledSkills) {
      if (!next.has(id)) onToggle(id)
    }
    // Toggle on skills that were added
    for (const id of next) {
      if (!enabledSkills.has(id)) onToggle(id)
    }
  }

  return (
    <SkillPicker value={value} onChange={handleChange} templateSkills={templateConfig?.skill_ids} />
  )
}
