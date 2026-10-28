const KNOWN_ROUTES = [
  '/',
  '/opportunities',
  '/opportunities/:id',
  '/applications',
  '/applications/:id',
  '/profile/student',
  '/profile/company',
  '/login',
  '/register-student',
  '/register-company',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/saved',
  '/interviews',
  '/messages',
  '/notifications',
  '/company',
  '/company/jobs',
  '/company/applicants',
  '/company/pipeline',
  '/company/shortlisted',
  '/admin',
  '/admin/verifications',
  '/admin/moderation',
  '/admin/reports',
  '/admin/audit-logs',
  '/admin/skill-assessments',
  '/company/analytics',
  '/privacy',
  '/privacy-security',
]

export function isKnownInternalRoute(route: string): boolean {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return false
  const pathname = route.split(/[?#]/, 1)[0]
  return KNOWN_ROUTES.some((known) => {
    if (known === pathname) return true
    if (!known.includes(':')) return false
    const pattern = known.split('/').map((segment) => segment.startsWith(':') ? '[^/]+' : segment).join('/')
    return new RegExp(`^${pattern}/?$`).test(pathname)
  })
}
