import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '../../store/auth'
import {
  LayoutDashboard,
  CheckCircle2,
  ShieldAlert,
  Users,
  Briefcase,
  Layers,
  MessageSquare,
  User,
  PlusCircle,
  Building,
  Home,
  Calendar,
  MoreHorizontal,
} from 'lucide-react'
import { routes } from '../../lib/routes'

export function BottomTabBar() {
  const { session } = useAuthStore()
  const location = useLocation()
  const role = session?.role
  const [adminMoreOpen, setAdminMoreOpen] = useState(false)

  const getTabs = () => {
    if (role === 'ADMIN') {
      return [
        { to: routes.admin, label: 'Overview', icon: LayoutDashboard },
        { to: routes.adminVerifications, label: 'Verify', icon: CheckCircle2 },
        { to: routes.adminModeration, label: 'Moderate', icon: ShieldAlert },
        { to: routes.adminUsers(), label: 'Users', icon: Users },
        { to: 'admin-more', label: 'More', icon: MoreHorizontal },
      ]
    }

    if (role === 'STUDENT') {
      return [
        { to: routes.opportunities, label: 'Discover', icon: Briefcase },
        { to: routes.applications(), label: 'Applied', icon: Layers },
        { to: routes.interviews({ tab: 'upcoming' }), label: 'Interviews', icon: Calendar },
        { to: routes.messages(), label: 'Messages', icon: MessageSquare },
        { to: routes.studentProfile, label: 'Profile', icon: User },
      ]
    }

    if (role === 'COMPANY') {
      return [
        { to: routes.companyJobs(), label: 'My Jobs', icon: Briefcase },
        { to: routes.newCompanyInternship, label: 'Post Role', icon: PlusCircle },
        { to: routes.interviews({ tab: 'upcoming' }), label: 'Interviews', icon: Calendar },
        { to: routes.messages(), label: 'Messages', icon: MessageSquare },
        { to: routes.companyProfile, label: 'Profile', icon: Building },
      ]
    }

    // Default / Public
    return [
      { to: routes.home, label: 'Home', icon: Home },
      { to: routes.opportunities, label: 'Internships', icon: Briefcase },
      { to: routes.login(), label: 'Sign In', icon: User },
    ]
  }

  const tabs = getTabs()
  const adminMoreLinks = [
    { to: routes.adminStudents(), label: 'Students' },
    { to: routes.adminCompanies, label: 'Companies' },
    { to: routes.adminSkills, label: 'Skill assessments' },
    { to: routes.adminAuditLogs(), label: 'Audit logs' },
  ]

  const checkIsActive = (path: string) => {
    if (path === routes.home) return location.pathname === routes.home
    if (path === routes.admin) return location.pathname === routes.admin
    return location.pathname.startsWith(path)
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 md:hidden flex justify-around items-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800/80 h-14 pb-[env(safe-area-inset-bottom)] px-1 shadow-[0_-4px_25px_rgba(0,0,0,0.06)] select-none">
      {role === 'ADMIN' && adminMoreOpen && <div role="menu" aria-label="More admin pages" className="glass-strong absolute bottom-16 right-2 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">{adminMoreLinks.map((item) => <Link key={item.to} role="menuitem" to={item.to} onClick={() => setAdminMoreOpen(false)} className="block rounded-lg px-3 py-3 text-sm font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">{item.label}</Link>)}</div>}
      {tabs.map((tab) => {
        const active = checkIsActive(tab.to)
        const Icon = tab.icon

        if (role === 'ADMIN' && tab.to === 'admin-more') {
          const moreActive = adminMoreLinks.some((item) => location.pathname.startsWith(item.to.split('?')[0]))
          return (
            <button key={tab.to} type="button" aria-haspopup="menu" aria-expanded={adminMoreOpen} onClick={() => setAdminMoreOpen((open) => !open)} className={`flex-1 flex flex-col items-center justify-center py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${moreActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}>
              <span className={`p-1 px-2.5 rounded-full flex items-center justify-center ${moreActive ? 'bg-indigo-50 dark:bg-indigo-950/70' : ''}`}><Icon className="w-4 h-4" /></span>
              <span className="text-[10px] tracking-tight mt-0.5 font-medium">{tab.label}</span>
            </button>
          )
        }

        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={`flex-1 flex flex-col items-center justify-center py-1 transition-all active:scale-90 ${
              active
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <div
              className={`p-1 px-2.5 rounded-full transition-colors flex items-center justify-center ${
                active ? 'bg-indigo-50 dark:bg-indigo-950/70' : ''
              }`}
            >
              <Icon className="w-4 h-4" />
            </div>
            <span className={`text-[10px] tracking-tight mt-0.5 ${active ? 'font-bold' : 'font-medium'}`}>
              {tab.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}