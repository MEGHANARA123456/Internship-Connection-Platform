import { useEffect, useRef } from 'react'
import { Route, Routes, Navigate } from 'react-router-dom'
import { Navbar } from './components/layout/Navbar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { api } from './api/client'
import { useAuthStore } from './store/auth'

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

function DashboardRedirect() {
  const { session } = useAuthStore()
  if (!session) return <Navigate to="/login" replace />
  if (session.role === 'ADMIN') return <Navigate to="/admin" replace />
  if (session.role === 'COMPANY') return <Navigate to="/company/jobs" replace />
  return <Navigate to="/opportunities" replace />
}

// Pages
import { LandingPage } from './pages/LandingPage'
import {
  LoginPage,
  StudentRegisterPage,
  CompanyRegisterPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AuthPages'

import {
  OpportunitiesPage,
  ApplicationsPage,
  StudentProfilePage,
  StudentAnalyticsPage,
} from './pages/StudentPages'

import {
  CompanyJobsPage,
  JobFormPage,
  JobApplicantsPage,
  CompanyProfilePage,
} from './pages/CompanyPages'

import {
  InterviewsPage,
  MessagesPage,
  NotificationsPage,
} from './pages/CommunicationPages'

import {
  AdminDashboardPage,
  AdminUsersPage,
  AdminVerificationsPage,
  AdminModerationPage,
  AdminReportsPage,
  AdminCompaniesPage,
  AdminCompanyPostingsPage,
  AdminAuditLogsPage,
} from './pages/AdminPages'

import { CollegePlacementPortal } from './pages/CollegePlacementPortal'
import { MobileViewSimulator } from './components/ui/MobileViewSimulator'
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage'
import { PrivacySecurityPage } from './pages/PrivacySecurityPage'
import { CookieConsentBanner } from './components/ui/CookieConsentBanner'
import { Footer } from './components/landing/Footer'

function ProfileRedirect() {
  const { session } = useAuthStore()
  if (!session) return <Navigate to="/login" replace />
  if (session.role === 'COMPANY') return <Navigate to="/profile/company" replace />
  if (session.role === 'ADMIN') return <Navigate to="/admin" replace />
  return <Navigate to="/profile/student" replace />
}

export default function App() {
  return (
    <MobileViewSimulator>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased transition-colors">
        <SessionIdentityVerifier />
        <Navbar />

        <main className="flex-1 flex flex-col">
          <Routes>
            {/* Public & Discovery */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/opportunities" element={<OpportunitiesPage />} />
            <Route path="/opportunities/:id" element={<OpportunitiesPage />} />
            <Route path="/internships/:id" element={<OpportunitiesPage />} />
            <Route path="/college/dashboard" element={<CollegePlacementPortal />} />
            <Route path="/dashboard" element={<DashboardRedirect />} />

            {/* Authentication */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register-student" element={<StudentRegisterPage />} />
            <Route path="/register-company" element={<CompanyRegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify" element={<VerifyEmailPage />} />
            <Route path="/verify/:token" element={<VerifyEmailPage />} />

            {/* Unified Profile Route */}
            <Route path="/profile" element={<ProfileRedirect />} />

            {/* Student Dedicated Routes */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT']} />}>
              <Route path="/saved" element={<OpportunitiesPage initialTab="saved" />} />
              <Route path="/student/analytics" element={<StudentAnalyticsPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/profile/student" element={<StudentProfilePage />} />
            </Route>

            {/* Company Dedicated Routes */}
            <Route path="/company" element={<Navigate to="/company/jobs" replace />} />
            <Route path="/company/dashboard" element={<Navigate to="/company/jobs" replace />} />
            <Route element={<ProtectedRoute allowedRoles={['COMPANY']} />}>
              <Route path="/company/jobs" element={<CompanyJobsPage />} />
              <Route path="/company/internships/new" element={<JobFormPage />} />
              <Route path="/company/internships/:id/edit" element={<JobFormPage />} />
              <Route path="/company/jobs/:id/applicants" element={<JobApplicantsPage />} />
              <Route path="/profile/company" element={<CompanyProfilePage />} />
            </Route>

            {/* Shared Authenticated Communication Routes */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT', 'COMPANY', 'ADMIN']} />}>
              <Route path="/interviews" element={<InterviewsPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>

            {/* Admin Oversight Dashboard */}
            <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
            <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/verifications" element={<AdminVerificationsPage />} />
              <Route path="/admin/moderation" element={<AdminModerationPage />} />
              <Route path="/admin/reports" element={<AdminReportsPage />} />
              <Route path="/admin/companies" element={<AdminCompaniesPage />} />
              <Route path="/admin/companies/:companyId/postings" element={<AdminCompanyPostingsPage />} />
              <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
            </Route>

            {/* Privacy & Regulatory Compliance (GDPR / CCPA) */}
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="/privacy-center" element={<PrivacySecurityPage />} />
            <Route path="/settings/privacy" element={<PrivacySecurityPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        <Footer />
        <CookieConsentBanner />
      </div>
    </MobileViewSimulator>
  )
}
