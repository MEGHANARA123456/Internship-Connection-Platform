import { Route, Routes, Navigate, Link } from 'react-router-dom'
import { Navbar } from './components/layout/Navbar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuthStore } from './store/auth'

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
  AdminRegisterPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AuthPages'

import {
  OpportunitiesPage,
  ApplicationsPage,
  StudentProfilePage,
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
            <Route path="/register-admin" element={<AdminRegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify" element={<VerifyEmailPage />} />
            <Route path="/verify/:token" element={<VerifyEmailPage />} />

            {/* Unified Profile Route */}
            <Route path="/profile" element={<ProfileRedirect />} />

            {/* Student Dedicated Routes */}
            <Route element={<ProtectedRoute allowedRoles={['STUDENT']} />}>
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

            {/* Admin Oversight Console */}
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

        {/* Global Footer */}
        <footer className="w-full border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-800 dark:text-slate-200">InternSphere</span>
              <span>•</span>
              <span>Production Grade Verified Recruitment</span>
              <span>•</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">GDPR & CCPA Compliant</span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Link to="/privacy" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                Privacy Policy
              </Link>
              <Link to="/privacy-center" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                Privacy & Security Center
              </Link>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('open:cookie-preferences'))}
                className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer"
              >
                Cookie Preferences
              </button>
              <span>© {new Date().getFullYear()} All rights reserved.</span>
            </div>
          </div>
        </footer>

        <CookieConsentBanner />
      </div>
    </MobileViewSimulator>
  )
}
