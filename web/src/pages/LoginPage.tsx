import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import { MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

function getOAuthErrorMessage(t: (key: string) => string, code: string) {
  const messages: Record<string, string> = {
    missing_code: t('pages.login.errors.oauth.missingCode'),
    not_bound: t('pages.login.errors.oauth.notBound'),
    user_not_found: t('pages.login.errors.oauth.userNotFound'),
    system_account: t('pages.login.errors.oauth.systemAccount'),
    auth_required: t('pages.login.errors.oauth.authRequired'),
    oauth_failed: t('pages.login.errors.oauth.oauthFailed'),
  }
  return messages[code] || t('pages.login.errors.loginFailed')
}

export function LoginPage() {
  const { t } = useTranslation()
  const { user, isLoading: authLoading, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [wecomEnabled, setWecomEnabled] = useState(false)
  const [wecomLoading, setWecomLoading] = useState(false)

  // Check for OAuth error in URL params
  useEffect(() => {
    const err = searchParams.get('error')
    if (err) setError(getOAuthErrorMessage(t, err))
  }, [searchParams, t])

  // Check if WeChat Work login is available
  useEffect(() => {
    api
      .getWeComEnabled()
      .then((res) => setWecomEnabled(res.enabled))
      .catch(() => {})
  }, [])

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  const nextParam = searchParams.get('next')
  const next = nextParam?.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/'

  if (user) {
    return <Navigate to={next} replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await login(username, password)
      navigate(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pages.login.errors.submitFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleWeComLogin = async () => {
    setWecomLoading(true)
    try {
      const { url } = await api.getWeComAuthorizeUrl('login')
      window.location.href = url
    } catch {
      setError(t('pages.login.errors.startWeComFailed'))
      setWecomLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col items-center space-y-3 text-center">
          <Logo className="h-12 w-auto" />
          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold">Neutree Agent Platform</CardTitle>
            <CardDescription>{t('pages.login.subtitle')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('pages.login.fields.username.label')}</Label>
              <Input
                id="username"
                type="text"
                placeholder={t('pages.login.fields.username.placeholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('pages.login.fields.password.label')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('pages.login.fields.password.placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Spinner size="sm" />
                  {t('pages.login.actions.submitting')}
                </>
              ) : (
                t('pages.login.actions.submit')
              )}
            </Button>
          </form>

          {wecomEnabled && (
            <>
              <div className="relative my-4">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  {t('pages.login.labels.or')}
                </span>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleWeComLogin}
                disabled={wecomLoading}
              >
                {wecomLoading ? <Spinner size="sm" /> : <MessageSquare className="h-4 w-4" />}
                {t('pages.login.actions.signInWithWeCom')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
