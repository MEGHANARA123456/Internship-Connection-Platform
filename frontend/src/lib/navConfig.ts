import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  Lock,
  LogOut,
  MessageSquare,
  PlusCircle,
  ShieldAlert,
  Users,
  User,
  Bookmark,
  Smartphone,
} from 'lucide-react'
import { routes } from './routes'

export type NavigationRole = 'STUDENT' | 'COMPANY' | 'ADMIN' | 'GUEST'
export type NavigationCountSource = 'invites_new' | 'application_updates' | 'saved' | 'notifications'

export interface NavigationItem {
  id: string
  label: string
  route?: string
  icon: LucideIcon
  countSource?: NavigationCountSource
  action?: 'cookie-preferences' | 'view-mode' | 'sign-out'
}

export const navigationConfig: Record<NavigationRole, { topBar: NavigationItem[]; hamburger: NavigationItem[] }> = {
  STUDENT: {
    topBar: [
      { id: 'recommended', label: 'Recommended internships', route: routes.opportunities, icon: Briefcase },
      { id: 'invites', label: 'Interview invites', route: routes.interviews({ tab: 'upcoming' }), icon: Calendar, countSource: 'invites_new' },
      { id: 'application-status', label: 'Application status', icon: FileText, countSource: 'application_updates' },
      { id: 'saved-internships', label: 'Saved internships', route: routes.saved, icon: Bookmark },
    ],
    hamburger: [
      { id: 'messages', label: 'Messages & Chat', route: routes.messages(), icon: MessageSquare },
      { id: 'notifications', label: 'Notifications & Mailbox', route: routes.notifications, icon: Bell, countSource: 'notifications' },
      { id: 'analytics', label: 'Analytics', route: routes.studentAnalytics, icon: BarChart3 },
      { id: 'profile', label: 'My Profile', route: routes.studentProfile, icon: User },
      { id: 'privacy-center', label: 'Privacy & Security', route: routes.privacySecurity, icon: Lock },
      { id: 'cookie-preferences', label: 'Cookie preferences', icon: Lock, action: 'cookie-preferences' },
      { id: 'view-mode', label: 'Mobile/Desktop view toggle', icon: Smartphone, action: 'view-mode' },
      { id: 'sign-out', label: 'Sign out', icon: LogOut, action: 'sign-out' },
    ],
  },
  COMPANY: {
    topBar: [],
    hamburger: [
      { id: 'company-overview', label: 'Overview', route: routes.company, icon: Building2 },
      { id: 'company-profile', label: 'Company Profile', route: routes.companyProfile, icon: User },
      { id: 'company-jobs', label: 'My Internships', route: routes.companyJobs(), icon: Briefcase },
      { id: 'post-internship', label: 'Post Internship', route: routes.newCompanyInternship, icon: PlusCircle },
      { id: 'company-applicants', label: 'Applicants', route: routes.companyApplicants(), icon: Users },
      { id: 'company-pipeline', label: 'Hiring Pipeline', route: routes.companyPipeline, icon: BarChart3 },
      { id: 'company-interviews', label: 'Interviews', route: routes.interviews({ tab: 'upcoming' }), icon: Calendar },
      { id: 'company-shortlisted', label: 'Shortlisted', route: routes.companyShortlisted, icon: CheckCircle2 },
      { id: 'company-notifications', label: 'Notifications', route: routes.notifications, icon: Bell },
      { id: 'company-analytics', label: 'Analytics', route: routes.companyAnalytics, icon: BarChart3 },
      { id: 'company-settings', label: 'Settings', route: routes.companySettings, icon: Lock },
      { id: 'company-sign-out', label: 'Sign out', icon: LogOut, action: 'sign-out' },
    ],
  },
  ADMIN: {
    topBar: [],
    hamburger: [
      { id: 'admin-dashboard', label: 'Admin Dashboard', route: routes.admin, icon: BarChart3 },
      { id: 'admin-users', label: 'Users Management', route: routes.adminUsers(), icon: Users },
      { id: 'admin-verifications', label: 'Company Verifications', route: routes.adminVerifications, icon: CheckCircle2 },
      { id: 'admin-moderation', label: 'Jobs Queue', route: routes.adminModeration, icon: Briefcase },
      { id: 'admin-reports', label: 'Disputes', route: routes.adminReports(), icon: ShieldAlert },
      { id: 'admin-audit-logs', label: 'Audit Logs', route: routes.adminAuditLogs(), icon: FileText },
      { id: 'admin-notifications', label: 'Notifications & Mailbox', route: routes.notifications, icon: Bell, countSource: 'notifications' },
      { id: 'admin-privacy', label: 'Privacy & Security', route: routes.privacySecurity, icon: Lock },
      { id: 'admin-cookie-preferences', label: 'Cookie preferences', icon: Lock, action: 'cookie-preferences' },
      { id: 'admin-view-mode', label: 'Mobile/Desktop view toggle', icon: Smartphone, action: 'view-mode' },
      { id: 'admin-sign-out', label: 'Sign out', icon: LogOut, action: 'sign-out' },
    ],
  },
  GUEST: {
    topBar: [],
    hamburger: [
      { id: 'browse-internships', label: 'Browse Internships', route: routes.opportunities, icon: Briefcase },
      { id: 'sign-in', label: 'Sign in', route: routes.login(), icon: User },
      { id: 'join-student', label: 'Join as Student', route: routes.studentRegister, icon: PlusCircle },
    ],
  },
}

export const applicationStatusMenuItems = [
  { key: 'ALL', label: 'All', query: '' },
  { key: 'APPLIED', label: 'Applied', query: 'applied' },
  { key: 'UNDER_REVIEW', label: 'Under Review', query: 'under_review' },
  { key: 'SHORTLISTED', label: 'Shortlisted', query: 'shortlisted' },
  { key: 'INTERVIEW', label: 'Interview', query: 'interview_scheduled' },
  { key: 'SELECTED', label: 'Selected', query: 'selected' },
  { key: 'REJECTED', label: 'Rejected', query: 'rejected' },
  { key: 'WITHDRAWN', label: 'Withdrawn', query: 'withdrawn' },
] as const
