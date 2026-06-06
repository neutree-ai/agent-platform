import { PromptSourceView } from '@/components/prompt/PromptSourceView'
import type { ApiAgentRequest } from '@/lib/api/types'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BUILDER_KIND_COMMAND_CREATE,
  BUILDER_KIND_COMMAND_DELETE,
  BUILDER_KIND_COMMAND_UPDATE,
  BUILDER_KIND_CONFIG_UPDATE,
  BUILDER_KIND_PROMPT_LIBRARY_CREATE,
  BUILDER_KIND_PROMPT_LIBRARY_DELETE,
  BUILDER_KIND_PROMPT_LIBRARY_UPDATE,
  BUILDER_KIND_PROMPT_SET,
  BUILDER_KIND_SCHEDULE_CREATE,
  BUILDER_KIND_SCHEDULE_DELETE,
  BUILDER_KIND_SCHEDULE_UPDATE,
  BUILDER_KIND_SKILL_DISABLE,
  BUILDER_KIND_SKILL_ENABLE,
  CommandCreatePayloadSchema,
  CommandDeletePayloadSchema,
  CommandUpdatePayloadSchema,
  ConfigUpdatePayloadSchema,
  PromptLibraryCreatePayloadSchema,
  PromptLibraryDeletePayloadSchema,
  PromptLibraryUpdatePayloadSchema,
  PromptSetPayloadSchema,
  ScheduleCreatePayloadSchema,
  ScheduleDeletePayloadSchema,
  ScheduleUpdatePayloadSchema,
  SkillDisablePayloadSchema,
  SkillEnablePayloadSchema,
} from '@neutree-ai/types'

/**
 * Per-kind body renderers for the Agent Request card. The generic
 * `<AgentRequestCard>` provides chrome (label, status chip, Approve/Reject)
 * and slots whichever renderer matches `req.kind` into the body. Add a new
 * entry here when introducing a new Builder Mode action; the payload zod
 * schema lives in `internal/types/builder.ts` and is shared with cp.
 */
type BodyRenderer = (req: ApiAgentRequest) => ReactNode

const BODY_RENDERERS: Record<string, BodyRenderer> = {
  [BUILDER_KIND_SCHEDULE_CREATE]: (req) => <ScheduleCreateBody req={req} />,
  [BUILDER_KIND_SCHEDULE_UPDATE]: (req) => <ScheduleUpdateBody req={req} />,
  [BUILDER_KIND_SCHEDULE_DELETE]: (req) => (
    <DeleteBody req={req} schema={ScheduleDeletePayloadSchema} />
  ),
  [BUILDER_KIND_COMMAND_CREATE]: (req) => <CommandCreateBody req={req} />,
  [BUILDER_KIND_COMMAND_UPDATE]: (req) => <CommandUpdateBody req={req} />,
  [BUILDER_KIND_COMMAND_DELETE]: (req) => (
    <DeleteBody req={req} schema={CommandDeletePayloadSchema} />
  ),
  [BUILDER_KIND_SKILL_ENABLE]: (req) => (
    <SkillNamesBody req={req} schema={SkillEnablePayloadSchema} fieldKey="attach" />
  ),
  [BUILDER_KIND_SKILL_DISABLE]: (req) => (
    <SkillNamesBody req={req} schema={SkillDisablePayloadSchema} fieldKey="detach" />
  ),
  [BUILDER_KIND_CONFIG_UPDATE]: (req) => <ConfigUpdateBody req={req} />,
  [BUILDER_KIND_PROMPT_SET]: (req) => <PromptSetBody req={req} />,
  [BUILDER_KIND_PROMPT_LIBRARY_CREATE]: (req) => <PromptLibraryCreateBody req={req} />,
  [BUILDER_KIND_PROMPT_LIBRARY_UPDATE]: (req) => <PromptLibraryUpdateBody req={req} />,
  [BUILDER_KIND_PROMPT_LIBRARY_DELETE]: (req) => (
    <DeleteBody req={req} schema={PromptLibraryDeletePayloadSchema} />
  ),
}

export function renderAgentRequestBody(req: ApiAgentRequest): ReactNode | null {
  return BODY_RENDERERS[req.kind]?.(req) ?? null
}

function ScheduleCreateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = ScheduleCreatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) {
    return (
      <div className="text-tiny text-destructive">
        {t('components.chat.toolRenderers.agentRequest.invalidPayload')}
      </div>
    )
  }
  const p = parsed.data
  return (
    <FieldGrid>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
        <span className="font-medium text-foreground">{p.name}</span>
      </Field>
      {p.cron ? (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.cron')}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
            {p.cron}
          </code>
          <span className="ml-2 text-muted-foreground">{p.timezone ?? 'UTC'}</span>
        </Field>
      ) : (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.runAt')}>
          <span className="text-foreground">
            {p.run_at ? new Date(p.run_at).toLocaleString() : ''}
          </span>
        </Field>
      )}
      {(p.prompt || p.prompt_id) && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.prompt')}>
          <PromptSourceView promptId={p.prompt_id} content={p.prompt} maxHeight="200px" />
        </Field>
      )}
    </FieldGrid>
  )
}

function CommandCreateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = CommandCreatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) {
    return (
      <div className="text-tiny text-destructive">
        {t('components.chat.toolRenderers.agentRequest.invalidPayload')}
      </div>
    )
  }
  const p = parsed.data
  return (
    <FieldGrid>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
        <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">/{p.name}</code>
      </Field>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.type')}>
        <span className="text-foreground">
          {t(`components.chat.toolRenderers.agentRequest.commandTypes.${p.type}`)}
        </span>
      </Field>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.prompt')}>
        <PromptSourceView promptId={p.prompt_id} content={p.prompt} maxHeight="200px" />
      </Field>
    </FieldGrid>
  )
}

function ScheduleUpdateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = ScheduleUpdatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      <IdField id={p.id} />
      {p.name !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
          <span className="font-medium text-foreground">{p.name}</span>
        </Field>
      )}
      {p.run_at !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.runAt')}>
          <span className="text-foreground">{new Date(p.run_at).toLocaleString()}</span>
        </Field>
      )}
      {p.cron !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.cron')}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
            {p.cron}
          </code>
        </Field>
      )}
      {p.timezone !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.timezone')}>
          <span className="text-foreground">{p.timezone}</span>
        </Field>
      )}
      {p.enabled !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.enabled')}>
          <span className="text-foreground">
            {t(
              `components.chat.toolRenderers.agentRequest.enabledStates.${p.enabled ? 'on' : 'off'}`,
            )}
          </span>
        </Field>
      )}
      {(p.prompt !== undefined || p.prompt_id !== undefined) && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.prompt')}>
          <PromptSourceView promptId={p.prompt_id} content={p.prompt} maxHeight="200px" />
        </Field>
      )}
    </FieldGrid>
  )
}

function CommandUpdateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = CommandUpdatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      <IdField id={p.id} />
      {p.name !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
            /{p.name}
          </code>
        </Field>
      )}
      {p.type !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.type')}>
          <span className="text-foreground">
            {t(`components.chat.toolRenderers.agentRequest.commandTypes.${p.type}`)}
          </span>
        </Field>
      )}
      {(p.prompt !== undefined || p.prompt_id !== undefined) && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.prompt')}>
          <PromptSourceView promptId={p.prompt_id} content={p.prompt} maxHeight="200px" />
        </Field>
      )}
    </FieldGrid>
  )
}

function ConfigUpdateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = ConfigUpdatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      {p.name !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
          <span className="font-medium text-foreground">{p.name}</span>
        </Field>
      )}
      {p.slug !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.slug')}>
          {p.slug ? (
            <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
              {p.slug}
            </code>
          ) : (
            <ClearedHint />
          )}
        </Field>
      )}
      {p.visibility !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.visibility')}>
          <span className="text-foreground">
            {t(`components.chat.toolRenderers.agentRequest.visibilityValues.${p.visibility}`)}
          </span>
        </Field>
      )}
      {p.agent_type !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.agentType')}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
            {p.agent_type}
          </code>
        </Field>
      )}
      {p.provider_id !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.provider')}>
          {p.provider_id ? (
            <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
              {p.provider_id}
            </code>
          ) : (
            <ClearedHint />
          )}
        </Field>
      )}
      {p.model !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.model')}>
          <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
            {p.model}
          </code>
        </Field>
      )}
      {p.small_model !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.smallModel')}>
          {p.small_model ? (
            <code className="rounded bg-muted/60 px-1 py-0.5 text-foreground font-mono">
              {p.small_model}
            </code>
          ) : (
            <ClearedHint />
          )}
        </Field>
      )}
    </FieldGrid>
  )
}

function PromptSetBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = PromptSetPayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.systemPrompt')}>
        {p.prompt_id ? (
          <PromptSourceView promptId={p.prompt_id} maxHeight="200px" />
        ) : p.system_prompt ? (
          <PromptSourceView content={p.system_prompt} maxHeight="200px" />
        ) : (
          <ClearedHint />
        )}
      </Field>
    </FieldGrid>
  )
}

function PromptLibraryCreateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = PromptLibraryCreatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
        <span className="font-medium text-foreground">{p.name}</span>
      </Field>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.visibility')}>
        <span className="text-foreground">
          {t(
            `components.chat.toolRenderers.agentRequest.visibilityValues.${p.visibility ?? 'private'}`,
          )}
        </span>
      </Field>
      <Field label={t('components.chat.toolRenderers.agentRequest.fields.content')}>
        <PromptSourceView content={p.content} maxHeight="200px" />
      </Field>
    </FieldGrid>
  )
}

function PromptLibraryUpdateBody({ req }: { req: ApiAgentRequest }) {
  const { t } = useTranslation()
  const parsed = PromptLibraryUpdatePayloadSchema.safeParse(req.payload)
  if (!parsed.success) return <InvalidPayload />
  const p = parsed.data
  return (
    <FieldGrid>
      <IdField id={p.id} />
      {p.name !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.name')}>
          <span className="font-medium text-foreground">{p.name}</span>
        </Field>
      )}
      {p.visibility !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.visibility')}>
          <span className="text-foreground">
            {t(`components.chat.toolRenderers.agentRequest.visibilityValues.${p.visibility}`)}
          </span>
        </Field>
      )}
      {p.content !== undefined && (
        <Field label={t('components.chat.toolRenderers.agentRequest.fields.content')}>
          <PromptSourceView content={p.content} maxHeight="200px" />
        </Field>
      )}
    </FieldGrid>
  )
}

function ClearedHint() {
  const { t } = useTranslation()
  return (
    <span className="text-muted-foreground italic">
      {t('components.chat.toolRenderers.agentRequest.cleared')}
    </span>
  )
}

function SkillNamesBody({
  req,
  schema,
  fieldKey,
}: {
  req: ApiAgentRequest
  schema: { safeParse: (v: unknown) => { success: boolean; data?: { names: string[] } } }
  fieldKey: 'attach' | 'detach'
}) {
  const { t } = useTranslation()
  const parsed = schema.safeParse(req.payload)
  if (!parsed.success || !parsed.data) return <InvalidPayload />
  return (
    <FieldGrid>
      <Field label={t(`components.chat.toolRenderers.agentRequest.fields.${fieldKey}`)}>
        <div className="flex flex-wrap gap-1">
          {parsed.data.names.map((n) => (
            <code
              key={n}
              className="rounded bg-muted/60 px-1.5 py-0.5 text-foreground font-mono text-mini"
            >
              {n}
            </code>
          ))}
        </div>
      </Field>
    </FieldGrid>
  )
}

function DeleteBody({
  req,
  schema,
}: {
  req: ApiAgentRequest
  schema: { safeParse: (v: unknown) => { success: boolean; data?: { id: string } } }
}) {
  const parsed = schema.safeParse(req.payload)
  if (!parsed.success || !parsed.data) return <InvalidPayload />
  return (
    <FieldGrid>
      <IdField id={parsed.data.id} />
    </FieldGrid>
  )
}

function IdField({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <Field label={t('components.chat.toolRenderers.agentRequest.fields.id')}>
      <code className="text-mini text-muted-foreground font-mono">{id}</code>
    </Field>
  )
}

function InvalidPayload() {
  const { t } = useTranslation()
  return (
    <div className="text-tiny text-destructive">
      {t('components.chat.toolRenderers.agentRequest.invalidPayload')}
    </div>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-tiny">{children}</dl>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground pt-0.5">{label}</dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </>
  )
}
