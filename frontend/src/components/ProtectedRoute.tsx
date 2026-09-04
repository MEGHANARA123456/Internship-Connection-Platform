import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore, type UserRole } from '../store/auth'

export function ProtectedRoute({ allowedRoles }: { allowedRoles?: UserRole[] }) {
  const session = useAuthStore((state) => state.session)

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}