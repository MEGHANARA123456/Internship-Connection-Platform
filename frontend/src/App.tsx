import { Route, Routes, Navigate } from 'react-router-dom'
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
} from './pages/AdminPages'

import { CollegePlacementPortal } from './pages/CollegePlacementPortal'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased transition-colors">
      <Navbar />

      <main className="flex-1 flex flex-col">
        <Routes>
          {/* Public & Discovery */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
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

          {/* Student Dedicated Routes */}
          <Route element={<ProtectedRoute allowedRoles={['STUDENT']} />}>
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/profile/student" element={<StudentProfilePage />} />
          </Route>

          {/* Company Dedicated Routes */}
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
          <Route element={<ProtectedRoute allowedRoles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/verifications" element={<AdminVerificationsPage />} />
            <Route path="/admin/moderation" element={<AdminModerationPage />} />
            <Route path="/admin/reports" element={<AdminReportsPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Global Footer */}
      <footer className="w-full border-t border-slate-200 bg-white py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">Internship Connection Platform</span>
            <span>•</span>
            <span>Production Grade Verified Recruitment</span>
          </div>
          <p>© {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
