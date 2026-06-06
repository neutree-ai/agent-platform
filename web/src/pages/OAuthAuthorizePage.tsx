import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

export function OAuthAuthorizePage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [clientName, setClientName] = useState<string | null>(null)
  const [scope, setScope] = useState('profile')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const clientId = searchParams.get('client_id')
  const redirectUri = searchParams.get('redirect_uri')
  const responseType = searchParams.get('response_type')
  const state = searchParams.get('state')
  const codeChallenge = searchParams.get('code_challenge')
  const codeChallengeMethod = searchParams.get('code_challenge_method')

  useEffect(() => {
    if (!clientId || !redirectUri || responseType !== 'code') {
      setError(t('pages.oauthAuthorize.errors.invalidRequest'))
      setIsLoading(false)
      return
    }

    fetch(`/api/oauth/authorize?${searchParams.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json()
          throw new Error(
            data.error_description || data.error || t('pages.oauthAuthorize.errors.invalidRequest'),
          )
        }
        return res.json()
      })
      .then((data) => {
        setClientName(data.client_name)
        setScope(data.scope)
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false))
  }, [clientId, redirectUri, responseType, searchParams, t])

  const handleAuthorize = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: responseType,
          state: state || undefined,
          code_challenge: codeChallenge || undefined,
          code_challenge_method: codeChallengeMethod || undefined,
          scope,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(
          data.error_description || data.error || t('pages.oauthAuthorize.errors.authorizeFailed'),
        )
      }

      const data = await res.json()
      window.location.href = data.redirect_uri
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('pages.oauthAuthorize.errors.authorizeFailed'),
      )
      setIsSubmitting(false)
    }
  }

  const handleDeny = () => {
    if (redirectUri) {
      const url = new URL(redirectUri)
      url.searchParams.set('error', 'access_denied')
      if (state) url.searchParams.set('state', state)
      window.location.href = url.toString()
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">{t('pages.oauthAuthorize.title')}</CardTitle>
          {clientName && (
            <CardDescription>
              <span className="font-medium text-foreground">{clientName}</span>{' '}
              {t('pages.oauthAuthorize.subtitle')}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                {t('pages.oauthAuthorize.permissionNotice')}
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleDeny}
                  disabled={isSubmitting}
                >
                  {t('pages.oauthAuthorize.actions.deny')}
                </Button>
                <Button className="flex-1" onClick={handleAuthorize} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Spinner size="sm" />
                      {t('pages.oauthAuthorize.actions.authorizing')}
                    </>
                  ) : (
                    t('pages.oauthAuthorize.actions.authorize')
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
