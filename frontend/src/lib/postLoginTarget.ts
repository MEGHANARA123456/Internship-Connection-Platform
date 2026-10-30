import { routes } from './routes'

export function getRoleHome(role?: string | null): string {
  const normalized = (role ?? '').toUpperCase()
  if (normalized === 'ADMIN') return routes.admin
  if (normalized === 'COMPANY') return routes.companyJobs()
  return routes.opportunities
}

export function isSameOriginRelativePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return false
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return false
  }
  return true
}

export function isRouteAllowedForRole(role: string | null | undefined, path: string): boolean {
  const normalizedRole = (role ?? '').toUpperCase()
  const pathname = path.split('?')[0].split('#')[0]

  // Prevent redirect loops back to auth pages or generic dashboard
  if (
    pathname === routes.login() ||
    pathname === '/login' ||
    pathname === routes.studentRegister ||
    pathname === '/register-student' ||
    pathname === routes.companyRegister ||
    pathname === '/register-company' ||
    pathname === routes.dashboard ||
    pathname === '/dashboard'
  ) {
    return false
  }

  // Company-only paths
  if (
    pathname === routes.company ||
    pathname === '/company' ||
    pathname.startsWith('/company/') ||
    pathname === routes.companyProfile ||
    pathname === '/profile/company'
  ) {
    return normalizedRole === 'COMPANY'
  }

  // Admin-only paths
  if (
    pathname === routes.admin ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/')
  ) {
    return normalizedRole === 'ADMIN'
  }

  // Student-only paths
  if (
    pathname === routes.saved ||
    pathname === '/saved' ||
    pathname === routes.studentAnalytics ||
    pathname.startsWith('/student/') ||
    pathname === routes.applications() ||
    pathname === '/applications' ||
    pathname.startsWith('/applications/') ||
    pathname === routes.studentProfile ||
    pathname === '/profile/student' ||
    pathname.startsWith('/skills/')
  ) {
    return normalizedRole === 'STUDENT'
  }

  // Shared routes between Student and Company
  if (
    pathname === '/interviews' ||
    pathname.startsWith('/interviews') ||
    pathname === '/messages' ||
    pathname.startsWith('/messages')
  ) {
    return normalizedRole === 'STUDENT' || normalizedRole === 'COMPANY'
  }

  // Shared / public authenticated pages (/opportunities, /notifications, /privacy*, etc.)
  return true
}

export function resolvePostLoginTarget(
  role: string | null | undefined,
  next: string | null | undefined,
): string {
  const roleHome = getRoleHome(role)
  if (!isSameOriginRelativePath(next)) {
    return roleHome
  }
  const trimmed = next.trim()
  if (!isRouteAllowedForRole(role, trimmed)) {
    return roleHome
  }
  return trimmed
}

