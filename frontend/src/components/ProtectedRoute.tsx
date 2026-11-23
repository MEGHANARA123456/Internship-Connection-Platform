import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageLoader } from './ui/LoadingSkeleton'
import { useAuthStore, type UserRole } from '../store/auth'
import { routes } from '../lib/routes'
import { getRoleHome } from '../lib/postLoginTarget'

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: UserRole[] }) {
  const session = useAuthStore((state) => state.session)
  const authInitialized = useAuthStore((state) => state.authInitialized)
  const authChecking = useAuthStore((state) => state.authChecking)
  const signedOutDeliberately = useAuthStore((state) => state.signedOutDeliberately)
  const location = useLocation()

  if (!authInitialized || authChecking) return <PageLoader />

  if (!session) {
    if (signedOutDeliberately) {
      return <Navigate to={routes.login()} replace />
    }
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={routes.login({ next })} replace />
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return <Navigate to={getRoleHome(session.role)} replace />
  }

  return <Outlet />
}
