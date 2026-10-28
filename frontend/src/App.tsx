import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Route, Routes, Navigate, Outlet, useParams } from 'react-router-dom'
import { Navbar } from './components/layout/Navbar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { api } from './api/client'
import { useAuthStore } from './store/auth'
import { PageLoader } from './components/ui/LoadingSkeleton'
import { FeedbackHost } from './components/ui/FeedbackHost'
import { routes } from './lib/routes'
import { NotFoundPage } from './pages/RouteFallbacks'

export function SessionIdentityVerifier() {
  const session = useAuthStore((state) => state.session)
  const setSession = useAuthStore((state) => state.setSession)
  const identityKey = session
    ? `${session.userId ?? ''}:${session.email?.trim().toLowerCase() ?? ''}`
    : null
  const verificationKey = session && identityKey
    ? `${identityKey}:${session.accessToken}`
    : null
  const verifiedSessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!session?.accessToken || !verificationKey || !identityKey) {
      verifiedSessionRef.current = null
      return
    }
    if (verifiedSessionRef.current === verificationKey) return

    verifiedSessionRef.current = verificationKey
    const accessToken = session.accessToken
    void api.get('/auth/me')
      .then(({ data }) => {
        if (data?.id == null || !data.email) return
        const currentSession = useAuthStore.getState().session
        if (currentSession?.accessToken !== accessToken) return

        const serverIdentityKey = `${data.id}:${String(data.email).trim().toLowerCase()}`
        verifiedSessionRef.current = `${serverIdentityKey}:${accessToken}`
        setSession({
          ...currentSession,
          userId: data.id,
          email: data.email,
          name: data.name ?? undefined,
        })
      })
      .catch((error: unknown) => {
        console.error('Unable to verify the current session with /auth/me.', error)
      })
  }, [identityKey, verificationKey, session?.accessToken, setSession])

  return null
}

function SessionChangedBanner() {
  const changed = useAuthStore((state) => state.sessionChangedInAnotherTab)
  const clearNotice = useAuthStore((state) => state.clearSessionChangedNotice)

  useEffect(() => {
    if (!changed) return
    const timeout = window.setTimeout(clearNotice, 5000)
    return () => window.clearTimeout(timeout)
  }, [changed, clearNotice])

  if (!changed) return null
  return (
    <div role="alert" className="fixed top-3 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-amber-100 px-4 py-3 text-sm font-medium text-amber-950 shadow-lg">
      Your session changed in another tab. This tab has been reloaded.
    </div>
  )
}

function RateLimitNotice() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let timeout: number | undefined
    const handleRateLimit = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; retryAfterSeconds?: number }>).detail
      setMessage(detail?.message || 'Too many requests. Please wait before trying again.')
      if (timeout !== undefined) window.clearTimeout(timeout)
      timeout = window.setTimeout(
        () => setMessage(''),
        Math.max(5, detail?.retryAfterSeconds ?? 5) * 1000,
      )
    }
    window.addEventListener('app:rate-limit', handleRateLimit)
    return () => {
      window.removeEventListener('app:rate-limit', handleRateLimit)
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [])

  if (!message) return null
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg bg-amber-100 px-4 py-3 text-sm font-medium text-amber-950 shadow-lg">
      {message}
    </div>
  )
}

function DashboardRedirect() {
  const { session } = useAuthStore()
  if (!session) return <Navigate to={routes.login({ next: routes.dashboard })} replace />
  if (session.role === 'ADMIN') return <Navigate to={routes.admin} replace />
  if (session.role === 'COMPANY') return <Navigate to={routes.companyJobs()} replace />
  return <Navigate to={routes.opportunities} replace />
}

function LegacyInternshipRedirect() {
  const { id } = useParams()
  return <Navigate to={id ? routes.opportunity(id) : routes.opportunities} replace />
}

// Pages
import { LandingPage } from './pages/LandingPage'
const authPages = () => import('./pages/AuthPages')
const LoginPage = lazy(async () => ({ default: (await authPages()).LoginPage }))
const StudentRegisterPage = lazy(async () => ({ default: (await authPages()).StudentRegisterPage }))
const CompanyRegisterPage = lazy(async () => ({ default: (await authPages()).CompanyRegisterPage }))
const ForgotPasswordPage = lazy(async () => ({ default: (await authPages()).ForgotPasswordPage }))
const ResetPasswordPage = lazy(async () => ({ default: (await authPages()).ResetPasswordPage }))
const VerifyEmailPage = lazy(async () => ({ default: (await authPages()).VerifyEmailPage }))

const studentPages = () => import('./pages/StudentPages')
const OpportunitiesPage = lazy(async () => ({ default: (await studentPages()).OpportunitiesPage }))
const ApplicationsPage = lazy(async () => ({ default: (await studentPages()).ApplicationsPage }))
const ApplicationTimelinePage = lazy(async () => ({ default: (await studentPages()).ApplicationTimelinePage }))
const StudentProfilePage = lazy(async () => ({ default: (await studentPages()).StudentProfilePage }))
const StudentAnalyticsPage = lazy(async () => ({ default: (await studentPages()).StudentAnalyticsPage }))
const skillAssessmentPages = () => import('./pages/SkillAssessmentPages')
const SkillAssessmentResultPage = lazy(async () => ({ default: (await skillAssessmentPages()).SkillAssessmentResultPage }))
const SkillAssessmentHistoryPage = lazy(async () => ({ default: (await skillAssessmentPages()).SkillAssessmentHistoryPage }))

const companyPages = () => import('./pages/CompanyPages')
const CompanyPortalShell = lazy(async () => ({ default: (await companyPages()).CompanyPortalShell }))
const CompanyOverviewPage = lazy(async () => ({ default: (await companyPages()).CompanyOverviewPage }))
const CompanyJobsPage = lazy(async () => ({ default: (await companyPages()).CompanyJobsPage }))
const CompanyAnalyticsPage = lazy(async () => ({ default: (await companyPages()).CompanyAnalyticsPage }))
const CompanyApplicantsPage = lazy(async () => ({ default: (await companyPages()).CompanyApplicantsPage }))
const CompanySettingsPage = lazy(async () => ({ default: (await companyPages()).CompanySettingsPage }))
const JobFormPage = lazy(async () => ({ default: (await companyPages()).JobFormPage }))
const JobApplicantsPage = lazy(async () => ({ default: (await companyPages()).JobApplicantsPage }))
const CompanyProfilePage = lazy(async () => ({ default: (await companyPages()).CompanyProfilePage }))

const communicationPages = () => import('./pages/CommunicationPages')
const InterviewsPage = lazy(async () => ({ default: (await communicationPages()).InterviewsPage }))
const MessagesPage = lazy(async () => ({ default: (await communicationPages()).MessagesPage }))
const NotificationsPage = lazy(async () => ({ default: (await communicationPages()).NotificationsPage }))

const adminPages = () => import('./pages/AdminPages')
const AdminDashboardPage = lazy(async () => ({ default: (await adminPages()).AdminDashboardPage }))
const AdminUsersPage = lazy(async () => ({ default: (await adminPages()).AdminUsersPage }))
const AdminVerificationsPage = lazy(async () => ({ default: (await adminPages()).AdminVerificationsPage }))
const AdminModerationPage = lazy(async () => ({ default: (await adminPages()).AdminModerationPage }))
const AdminReportsPage = lazy(async () => ({ default: (await adminPages()).AdminReportsPage }))
const AdminCompaniesPage = lazy(async () => ({ default: (await adminPages()).AdminCompaniesPage }))
const AdminCompanyPostingsPage = lazy(async () => ({ default: (await adminPages()).AdminCompanyPostingsPage }))
const AdminAuditLogsPage = lazy(async () => ({ default: (await adminPages()).AdminAuditLogsPage }))
const AdminSkillAssessmentsPage = lazy(async () => ({ default: (await adminPages()).AdminSkillAssessmentsPage }))
import { MobileViewSimulator } from './components/ui/MobileViewSimulator'
const PrivacyPolicyPage = lazy(async () => ({ default: (await import('./pages/PrivacyPolicyPage')).PrivacyPolicyPage }))
const PrivacySecurityPage = lazy(async () => ({ default: (await import('./pages/PrivacySecurityPage')).PrivacySecurityPage }))
const ChatbotWidget = lazy(async () => ({ default: (await import('./chatbot/ChatbotWidget')).ChatbotWidget }))
import { CookieConsentBanner } from './components/ui/CookieConsentBanner'
import { Footer } from './components/landing/Footer'

function ProfileRedirect() {
  const { session } = useAuthStore()
  if (!session) return <Navigate to={routes.login({ next: routes.profile })} replace />
  if (session.role === 'COMPANY') return <Navigate to={routes.companyProfile} replace />
  if (session.role === 'ADMIN') return <Navigate to={routes.admin} replace />
  return <Navigate to={routes.studentProfile} replace />
}

function CommunicationLayout() {
  const role = useAuthStore((state) => state.session?.role)
  return role === 'COMPANY' ? <CompanyPortalShell /> : <Outlet />
}

export default function App() {
  return (
    <MobileViewSimulator>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased transition-colors">
        <SessionIdentityVerifier />
        <SessionChangedBanner />
        <RateLimitNotice />
        <FeedbackHost />
        <Navbar />

        <main className="flex-1 flex flex-col">
          <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public & Discovery */}
            <Route path={routes.home} element={<LandingPage />} />
            <Route path={routes.opportunities} element={<OpportunitiesPage />} />
            <Route path={routes.opportunityDetail} element={<OpportunitiesPage />} />
            <Route path={routes.legacyInternship} element={<LegacyInternshipRedirect />} />
            <Route path={routes.dashboard} element={<DashboardRedirect />} />

            {/* Authentication */}
            <Route path={routes.login()} element={<LoginPage />} />
            <Route path={routes.studentRegister} element={<StudentRegisterPage />} />
            <Route path={routes.companyRegister} element={<CompanyRegisterPage />} />
            <Route path={routes.forgotPassword} element={<ForgotPasswordPage />} />
            <Route path={routes.resetPassword} element={<ResetPasswordPage />} />
            <Route path={routes.verify()} element={<VerifyEmailPage />} />
            <Route path={routes.verifyTokenRoute} element={<VerifyEmailPage />} />

            {/* Unified Profile Route */}
            <Route path={routes.profile} element={<ProfileRedirect />} />

            {/* Student Dedicated Routes */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT']} />}>
              <Route path={routes.saved} element={<OpportunitiesPage initialTab="saved" />} />
              <Route path={routes.studentAnalytics} element={<StudentAnalyticsPage />} />
              <Route path={routes.applications()} element={<ApplicationsPage />} />
              <Route path={routes.applicationDetail} element={<ApplicationTimelinePage />} />
              <Route path={routes.studentProfile} element={<StudentProfilePage />} />
              <Route path={routes.skillHistory} element={<SkillAssessmentHistoryPage />} />
              <Route path={routes.skillResultRoute} element={<SkillAssessmentResultPage />} />
            </Route>

            {/* Company Dedicated Routes */}
            <Route element={<ProtectedRoute allowedRoles={['COMPANY']} />}>
              <Route element={<CompanyPortalShell />}>
                <Route path={routes.company} element={<CompanyOverviewPage />} />
                <Route path={routes.companyDashboard} element={<Navigate to={routes.company} replace />} />
                <Route path={routes.companyJobs()} element={<CompanyJobsPage />} />
                <Route path={routes.companyAnalytics} element={<CompanyAnalyticsPage />} />
                <Route path={routes.companyApplicants()} element={<CompanyApplicantsPage />} />
                <Route path={routes.companyPipeline} element={<CompanyApplicantsPage pipeline />} />
                <Route path={routes.companyShortlisted} element={<CompanyApplicantsPage initialStatus="SHORTLISTED" />} />
                <Route path={routes.companySettings} element={<CompanySettingsPage />} />
                <Route path={routes.newCompanyInternship} element={<JobFormPage />} />
                <Route path={routes.companyJobEdit} element={<JobFormPage />} />
                <Route path={routes.companyJobApplicantsRoute} element={<JobApplicantsPage />} />
                <Route path={routes.companyProfile} element={<CompanyProfilePage />} />
              </Route>
            </Route>

            {/* Interviews and direct messages are limited to students and companies. */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT', 'COMPANY']} />}>
              <Route element={<CommunicationLayout />}>
                <Route path={routes.interviews()} element={<InterviewsPage />} />
                <Route path={routes.messages()} element={<MessagesPage />} />
              </Route>
            </Route>

            {/* Notifications and the personal mailbox are available to every account role. */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT', 'COMPANY', 'ADMIN']} />}>
              <Route element={<CommunicationLayout />}>
                <Route path={routes.notifications} element={<NotificationsPage />} />
              </Route>
            </Route>
            <Route element={<ProtectedRoute allowedRoles={['COMPANY']} />}>
              <Route path={routes.legacyCompanyInterviews} element={<Navigate to={routes.interviews({ tab: 'upcoming' })} replace />} />
            </Route>

            {/* Admin Oversight Dashboard */}
            <Route path={routes.adminDashboard} element={<Navigate to={routes.admin} replace />} />
            <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
              <Route path={routes.admin} element={<AdminDashboardPage />} />
              <Route path={routes.adminUsers()} element={<AdminUsersPage />} />
              <Route path={routes.adminVerifications} element={<AdminVerificationsPage />} />
              <Route path={routes.adminModeration} element={<AdminModerationPage />} />
              <Route path={routes.adminReports()} element={<AdminReportsPage />} />
              <Route path={routes.adminCompanies} element={<AdminCompaniesPage />} />
              <Route path={routes.adminCompanyPostingsRoute} element={<AdminCompanyPostingsPage />} />
              <Route path={routes.adminAuditLogsRoute} element={<AdminAuditLogsPage />} />
              <Route path={routes.adminSkills} element={<AdminSkillAssessmentsPage />} />
            </Route>

            {/* Privacy & Regulatory Compliance (GDPR / CCPA) */}
            <Route path={routes.privacyPolicy} element={<PrivacyPolicyPage />} />
            <Route path={routes.legacyPrivacyPolicy} element={<Navigate to={routes.privacyPolicy} replace />} />
            <Route path={routes.privacyCenter} element={<Navigate to={routes.privacySecurity} replace />} />
            <Route path={routes.privacySecurity} element={<PrivacySecurityPage />} />
            <Route path={routes.legacyPrivacySettings} element={<Navigate to={routes.privacySecurity} replace />} />

            {/* Fallback */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </Suspense>
        </main>

        <Footer />
        <CookieConsentBanner />
        <Suspense fallback={null}><ChatbotWidget /></Suspense>
      </div>
    </MobileViewSimulator>
  )
}
