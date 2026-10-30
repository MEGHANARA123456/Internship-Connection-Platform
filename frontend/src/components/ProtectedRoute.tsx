import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore, type UserRole } from '../store/auth'
import { routes } from '../lib/routes'
import { getRoleHome } from '../lib/postLoginTarget'

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: UserRole[] }) {
  const session = useAuthStore((state) => state.session)
  const signedOutDeliberately = useAuthStore((state) => state.signedOutDeliberately)
  const clearSignedOutDeliberately = useAuthStore((state) => state.clearSignedOutDeliberately)
  const location = useLocation()

  if (!session) {
    if (signedOutDeliberately) {
      clearSignedOutDeliberately()
      return <Navigate to={routes.login()} replace />
    }
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={routes.login({ next })} replace />
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    const home = getRoleHome(session.role)
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">This page isn&apos;t available for your account</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">You can continue to your dashboard instead.</p>
        <Link to={home} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          Go to your home
        </Link>
      </main>
    )
  }

  return <Outlet />
}
