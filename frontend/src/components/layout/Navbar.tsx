import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { api, getFullMediaUrl } from '../../api/client'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Logo } from './Logo'
import {
  Briefcase,
  Layers,
  Calendar,
  MessageSquare,
  Bell,
  User,
  LogOut,
  Menu,
  X,
  ShieldAlert,
  Building,
  CheckCircle2,
  Users,
  Sun,
  Moon,
  Smartphone,
  Monitor,
} from 'lucide-react'
import { useThemeStore } from '../../store/theme'
import { useViewModeStore } from '../../store/viewMode'
import { useWebSocketChat } from '../../lib/useWebSocketChat'

export function Navbar() {
  const { session, logout } = useAuthStore()
  const { setTheme, isDark } = useThemeStore()
  const { isMobileView, toggleMobileView } = useViewModeStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [unreadCount, setUnreadCount] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Maintain real-time WebSocket connection for notifications & presence
  useWebSocketChat(session?.userId)

  const role = session?.role

  useEffect(() => {
    if (!session?.accessToken) return
    let isMounted = true

    const fetchNotifications = () => {
      api
        .get('/notifications')
        .then((res) => {
          if (!isMounted) return
          const unread = res.data.filter((n: { read_at?: string | null }) => !n.read_at).length
          setUnreadCount(unread)
        })
        .catch(() => {})
    }

    fetchNotifications()

    const handleRealtimeNotification = () => {
      if (isMounted) {
        setUnreadCount((prev) => prev + 1)
        fetchNotifications()
      }
    }

    window.addEventListener('app:notification', handleRealtimeNotification)
    // Low frequency fallback interval (60 seconds)
    const interval = setInterval(fetchNotifications, 60000)

    return () => {
      isMounted = false
      window.removeEventListener('app:notification', handleRealtimeNotification)
      clearInterval(interval)
    }
  }, [session?.accessToken])

  const handleSignOut = () => {
    logout()
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  const mobileLinkClass = (path: string) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive(path)
        ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 font-semibold'
        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs shadow-2xs transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Logo size="md" />

          {role && (
            <Badge status={role} className="hidden sm:inline-flex text-[11px] font-semibold py-0.5 px-2">
              {role}
            </Badge>
          )}
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1">
          {!session && (
            <>
              <Link
                to="/opportunities"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive('/opportunities')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Browse Internships
              </Link>
              <Link
                to="/login"
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors ml-2"
              >
                Sign in
              </Link>
              <Link to="/register-student">
                <Button size="sm" variant="primary" className="ml-1">
                  Join as Student
                </Button>
              </Link>
            </>
          )}

          {role === 'STUDENT' && (
            <>
              <Link
                to="/opportunities"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/opportunities')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                Find Internships
              </Link>
              <Link
                to="/applications"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/applications')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Layers className="w-4 h-4" />
                My Applications
              </Link>
              <Link
                to="/interviews"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/interviews')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Interviews
              </Link>
              <Link
                to="/messages"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/messages')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Messages
              </Link>
              <Link
                to="/profile/student"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/profile/student')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <User className="w-4 h-4" />
                My Profile
              </Link>
            </>
          )}

          {role === 'COMPANY' && (
            <>
              <Link
                to="/company/jobs"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/company/jobs')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                Our Job Listings
              </Link>
              <Link
                to="/company/internships/new"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/company/internships/new')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Post an Internship
              </Link>
              <Link
                to="/interviews"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/interviews')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Calendar className="w-4 h-4" />
                Interviews
              </Link>
              <Link
                to="/messages"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/messages')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                Messages
              </Link>
              <Link
                to="/profile/company"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/profile/company')
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Building className="w-4 h-4" />
                Company Profile
              </Link>
            </>
          )}

          {role === 'ADMIN' && (
            <>
              <Link
                to="/admin"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/admin')
                    ? 'bg-purple-50 text-purple-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Layers className="w-4 h-4" />
                Console
              </Link>
              <Link
                to="/admin/users"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/admin/users')
                    ? 'bg-purple-50 text-purple-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Users className="w-4 h-4" />
                Users
              </Link>
              <Link
                to="/admin/verifications"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/admin/verifications')
                    ? 'bg-purple-50 text-purple-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                Verifications
              </Link>
              <Link
                to="/admin/moderation"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/admin/moderation')
                    ? 'bg-purple-50 text-purple-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Briefcase className="w-4 h-4" />
                Jobs Queue
              </Link>
              <Link
                to="/admin/reports"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive('/admin/reports')
                    ? 'bg-purple-50 text-purple-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
                Disputes
              </Link>
            </>
          )}
        </nav>

        {/* User Right Slot */}
        <div className="hidden md:flex items-center gap-2">
          {/* Mobile View / Desktop View Simulator Button */}
          <button
            onClick={toggleMobileView}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border cursor-pointer ${
              isMobileView
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}
            title={isMobileView ? 'Switch back to Full Desktop View' : 'Preview in Mobile Phone View'}
            aria-label="Toggle mobile device view"
          >
            {isMobileView ? (
              <>
                <Monitor className="w-3.5 h-3.5" />
                <span>Desktop View</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>Mobile View</span>
              </>
            )}
          </button>

          {/* Theme Toggle Button */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600 dark:text-slate-300" />}
          </button>

          {session && (
            <>
              <Link
                to="/notifications"
                className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                title="Notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>

              {/* Profile Avatar Quick Link */}
              <Link
                to={role === 'STUDENT' ? '/profile/student' : role === 'COMPANY' ? '/profile/company' : '/admin'}
                className="flex items-center gap-2 p-1 pl-1.5 pr-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors group"
                title="View & Edit Profile"
              >
                <div className="w-7 h-7 rounded-lg overflow-hidden bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-2xs">
                  {getFullMediaUrl(session.avatar_url) ? (
                    <img
                      src={getFullMediaUrl(session.avatar_url)!}
                      alt={session.name || 'User'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        ;(e.currentTarget as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : (
                    <span>
                      {session.name
                        ? session.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                        : (session.email ? session.email[0].toUpperCase() : 'U')}
                    </span>
                  )}
                </div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 max-w-[90px] truncate hidden xl:inline">
                  {session.name?.split(' ')[0] || 'Profile'}
                </span>
              </Link>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                leftIcon={<LogOut className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
                className="text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                Sign out
              </Button>
            </>
          )}
        </div>

        {/* Mobile menu right controls */}
        <div className="flex items-center gap-1.5 md:hidden">
          {/* Mobile Theme Toggle */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600 dark:text-slate-300" />}
          </button>

          {session && unreadCount > 0 && (
            <Link to="/notifications" className="relative p-1.5 text-slate-600 dark:text-slate-300">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            </Link>
          )}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 space-y-2">
          {!session ? (
            <div className="flex flex-col gap-2">
              <Link
                to="/opportunities"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Browse Internships
              </Link>
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Sign in
              </Link>
              <Link
                to="/register-student"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white text-center"
              >
                Register as Student
              </Link>
              <Link
                to="/register-company"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 text-center border border-slate-200"
              >
                Register Company
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="px-3 py-1.5 flex items-center justify-between border-b border-slate-100 mb-1">
                <span className="text-xs text-slate-500">Signed in as</span>
                <Badge status={role} className="text-xs">
                  {role}
                </Badge>
              </div>

              {role === 'STUDENT' && (
                <>
                  <Link to="/opportunities" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/opportunities')}>
                    Find Internships
                  </Link>
                  <Link to="/applications" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/applications')}>
                    My Applications
                  </Link>
                  <Link to="/interviews" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/interviews')}>
                    Interviews
                  </Link>
                  <Link to="/messages" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/messages')}>
                    Messages
                  </Link>
                  <Link to="/profile/student" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/profile/student')}>
                    My Profile & Resume
                  </Link>
                </>
              )}

              {role === 'COMPANY' && (
                <>
                  <Link to="/company/jobs" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/company/jobs')}>
                    Our Job Listings
                  </Link>
                  <Link to="/company/internships/new" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/company/internships/new')}>
                    Post New Internship
                  </Link>
                  <Link to="/interviews" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/interviews')}>
                    Scheduled Interviews
                  </Link>
                  <Link to="/messages" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/messages')}>
                    Messages
                  </Link>
                  <Link to="/profile/company" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/profile/company')}>
                    Company Profile
                  </Link>
                </>
              )}

              {role === 'ADMIN' && (
                <>
                  <Link to="/admin" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/admin')}>
                    Console Overview
                  </Link>
                  <Link to="/admin/users" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/admin/users')}>
                    Users Management
                  </Link>
                  <Link to="/admin/verifications" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/admin/verifications')}>
                    Company Verifications
                  </Link>
                  <Link to="/admin/moderation" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/admin/moderation')}>
                    Job Moderation
                  </Link>
                  <Link to="/admin/reports" onClick={() => setMobileOpen(false)} className={mobileLinkClass('/admin/reports')}>
                    Dispute Reports
                  </Link>
                </>
              )}

              <Link to="/notifications" onClick={() => setMobileOpen(false)} className={`flex items-center justify-between ${mobileLinkClass('/notifications')}`}>
                <span>Notifications</span>
                {unreadCount > 0 && <Badge status="REJECTED">{unreadCount} new</Badge>}
              </Link>

              <button
                onClick={() => {
                  setMobileOpen(false)
                  handleSignOut()
                }}
                className="w-full mt-2 px-3 py-2 text-left rounded-lg text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}
