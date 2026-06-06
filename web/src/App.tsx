import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Desktop } from './components/shell/Desktop'
import { useAuth } from './contexts/AuthContext'
import { useUpdateChecker } from './hooks/useUpdateChecker'

import { FleetPage } from './pages/FleetPage'
import { LoginPage } from './pages/LoginPage'
import { OAuthAuthorizePage } from './pages/OAuthAuthorizePage'

// Lazy-loaded: heavy pages
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
)
const SharePage = lazy(() => import('./pages/SharePage').then((m) => ({ default: m.SharePage })))
const InvitePage = lazy(() => import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })))

function Fallback() {
  const { t } = useTranslation()

  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      {t('common.loading')}
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <Fallback />
  }

  if (!user) {
    const next = location.pathname + location.search
    const target = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
    return <Navigate to={target} replace />
  }

  return <>{children}</>
}

function App() {
  useUpdateChecker()
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/oauth/authorize"
        element={
          <ProtectedRoute>
            <OAuthAuthorizePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Desktop>
              <FleetPage />
            </Desktop>
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceId"
        element={
          <ProtectedRoute>
            <Desktop>
              <WorkspacePage />
            </Desktop>
          </ProtectedRoute>
        }
      />
      <Route
        path="/s/:shareId"
        element={
          <Suspense fallback={<Fallback />}>
            <SharePage />
          </Suspense>
        }
      />
      <Route
        path="/invite/:token"
        element={
          <ProtectedRoute>
            <Suspense fallback={<Fallback />}>
              <InvitePage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
