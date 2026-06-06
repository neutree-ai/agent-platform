import { CONNECTOR_TYPES, ConnectorForm } from '@/components/IntegrationPage'
import { DocumentedDialog } from '@/components/ui/documented-dialog'
import type { DialogProps } from '@/contexts/DialogStackContext'
import { getConnectorDoc, getConnectorDocsHint } from '@/docs/inline-help/connector-docs'
import { cgApi } from '@/lib/api/channel-gateway'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * Create-connector dialog — registered against the DialogStack so the
 * same dialog can be triggered from the Connectors app and the Command
 * Palette via `openDialog('create-connector')`.
 */
export default function CreateConnectorDialog({ open, onOpenChange }: DialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [type, setType] = useState('slack')

  useEffect(() => {
    if (open) setType('slack')
  }, [open])

  const runTest = (id: string) => {
    cgApi
      .testConnector(id)
      .then((res) => {
        const d = res.detail
        toast.success(
          t('components.createConnector.toasts.connected', {
            team: d.team || '?',
            user: d.user || '?',
          }),
        )
      })
      .catch((err) => toast.error(err.message))
  }

  const createMutation = useMutation({
    mutationFn: cgApi.createConnector,
    onSuccess: (created, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cg-connectors'] })
      toast.success(t('components.createConnector.toasts.created'))
      onOpenChange(false)
      // If the connector type supports a connectivity probe, run it
      // immediately so the user gets a confirmed team/user readout
      // without having to click into the new row.
      if (created.id && CONNECTOR_TYPES[variables.type]?.testable) runTest(created.id)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <DocumentedDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('components.createConnector.title')}
      docs={getConnectorDoc(type)}
      docsHint={getConnectorDocsHint()}
      size="lg"
    >
      <ConnectorForm
        onSubmit={(data) => createMutation.mutate(data)}
        onCancel={() => onOpenChange(false)}
        loading={createMutation.isPending}
        onTypeChange={setType}
      />
    </DocumentedDialog>
  )
}
