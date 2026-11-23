import { useRef } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { PageLoader } from './ui/LoadingSkeleton'
import { getRoleHome } from '../lib/postLoginTarget'
import { useAuthStore } from '../store/auth'

export function GuestRoute() {
  const session = useAuthStore((state) => state.session)
  const authInitialized = useAuthStore((state) => state.authInitialized)
  const authChecking = useAuthStore((state) => state.authChecking)
  const startedAuthenticated = useRef(Boolean(session))

  if (!authInitialized || authChecking) return <PageLoader />
  if (session && startedAuthenticated.current) return <Navigate to={getRoleHome(session.role)} replace />
  return <Outlet />
}
