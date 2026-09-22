import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { api, getFullMediaUrl } from '../../api/client'
import { Badge } from '../ui/Badge'
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
  ShieldAlert,
  Building,
  CheckCircle2,
  Users,
  Sun,
  Moon,
  Smartphone,
  Monitor,
  Bookmark,
  GraduationCap,
  BarChart3,
  PlusCircle,
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
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const navMenuRef = useRef<HTMLDivElement>(null)

  // Click-outside and Escape to close the nav menu
  useEffect(() => {
    if (!navMenuOpen) return

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target || !navMenuRef.current) return
      const path = e.composedPath ? e.composedPath() : []
      if (path.length > 0) {
        if (path.includes(navMenuRef.current)) return
      } else if (navMenuRef.current.contains(target)) {
        return
      }
      setNavMenuOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavMenuOpen(false)
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [navMenuOpen])

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
        .catch(() => { })
    }

    fetchNotifications()

    const handleRealtimeNotification = () => {
      if (isMounted) {
        setUnreadCount((prev) => prev + 1)
        fetchNotifications()
      }
    }

    window.addEventListener('app:notification', handleRealtimeNotification)
    const interval = setInterval(fetchNotifications, 60000)

    return () => {
      isMounted = false
      window.removeEventListener('app:notification', handleRealtimeNotification)
      clearInterval(interval)
    }
  }, [session?.accessToken])

  const handleSignOut = () => {
    setNavMenuOpen(false)
    logout()
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  const linkRowClass = (path: string) =>
    `flex items-start gap-2.5 p-2 rounded-xl transition-all ${isActive(path)
      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
    }`

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs shadow-2xs transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Logo size="md" />
          {role && (
            <Badge status={role} className="text-[11px] font-semibold py-0.5 px-2">
              {role}
            </Badge>
          )}
        </div>

        {/* Right controls: theme, notifications, single hamburger menu */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-slate-600 dark:text-slate-300" />}
          </button>

          {session && (
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
          )}

          <div className="relative" ref={navMenuRef}>
            <button
              type="button"
              onClick={() => setNavMenuOpen((prev) => !prev)}
              title="Menu"
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Open navigation menu"
              aria-expanded={navMenuOpen}
            >
              <Menu className="w-6 h-6" />
            </button>

            {navMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5 px-1">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">Navigation</h4>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Direct access to all platform workflows</p>
                  </div>
                  {role ? (
                    <Badge status={role} className="text-[10px] py-0.5 px-1.5">
                      {role}
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">Guest</span>
                  )}
                </div>

                <div className="space-y-1">
                  {role === 'STUDENT' && (
                    <>
                      <Link to="/applications" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/applications')}>
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">My Applications</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Track recruitment stages, status changes & offers</p>
                        </div>
                      </Link>

                      <Link to="/opportunities" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/opportunities')}>
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Find Internships</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Browse verified opportunities with direct applications</p>
                        </div>
                      </Link>

                      <Link to="/interviews" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/interviews')}>
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Interviews</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">View scheduled timeslots and recruiter meetings</p>
                        </div>
                      </Link>

                      <Link to="/messages" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/messages')}>
                        <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/60 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Messages & Chat</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Real-time chat with employers and recruiters</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link to="/saved" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <Bookmark className="w-3.5 h-3.5 text-amber-500" />
                          <span>Saved Jobs</span>
                        </Link>
                        <Link to="/college" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Placement Hub</span>
                        </Link>
                        <Link to="/student" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Analytics</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {role === 'COMPANY' && (
                    <>
                      <Link to="/company/jobs" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/company/jobs')}>
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Our Job Listings</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage active postings, applicants and drafts</p>
                        </div>
                      </Link>

                      <Link to="/company/internships/new" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/company/internships/new')}>
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <PlusCircle className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Post an Internship</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Create and publish verified internship opportunities</p>
                        </div>
                      </Link>

                      <Link to="/interviews" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/interviews')}>
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Interviews</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage and coordinate candidate interview meetings</p>
                        </div>
                      </Link>

                      <Link to="/messages" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/messages')}>
                        <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/60 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Messages</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Communicate directly with shortlisted students</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link to="/company" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Analytics</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {role === 'ADMIN' && (
                    <>
                      <Link to="/admin" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/admin')}>
                        <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Admin Console</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Platform ecosystem metrics & system health</p>
                        </div>
                      </Link>

                      <Link to="/admin/users" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/admin/users')}>
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Users Management</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage students, recruiters and admin accounts</p>
                        </div>
                      </Link>

                      <Link to="/admin/verifications" onClick={() => setNavMenuOpen(false)} className={linkRowClass('/admin/verifications')}>
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Company Verifications</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Review and approve employer documentation</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link to="/admin/moderation" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <Briefcase className="w-3.5 h-3.5 text-purple-500" />
                          <span>Jobs Queue</span>
                        </Link>
                        <Link to="/admin/reports" onClick={() => setNavMenuOpen(false)} className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                          <span>Disputes</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {!session && (
                    <>
                      <Link to="/opportunities" onClick={() => setNavMenuOpen(false)} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200">
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Browse Internships</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Explore openings across top employers</p>
                        </div>
                      </Link>

                      <Link to="/college" onClick={() => setNavMenuOpen(false)} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200">
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <GraduationCap className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">College Placement Portal</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Institutional campus placements</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link to="/login" onClick={() => setNavMenuOpen(false)} className="flex items-center justify-center p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          Sign in
                        </Link>
                        <Link to="/register-student" onClick={() => setNavMenuOpen(false)} className="flex items-center justify-center p-1.5 px-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                          Join as Student
                        </Link>
                      </div>
                    </>
                  )}
                </div>

                {/* Account footer: profile, mobile-view toggle, sign out — only when logged in */}
                {session && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1">
                    <Link
                      to={role === 'STUDENT' ? '/profile/student' : role === 'COMPANY' ? '/profile/company' : '/admin'}
                      onClick={() => setNavMenuOpen(false)}
                      className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200"
                    >
                      <div className="w-6 h-6 rounded-lg overflow-hidden bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                        {getFullMediaUrl(session.avatar_url) ? (
                          <img
                            src={getFullMediaUrl(session.avatar_url)!}
                            alt={session.name || 'User'}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              ; (e.currentTarget as HTMLElement).style.display = 'none'
                            }}
                          />
                        ) : (
                          <span>
                            {session.name
                              ? session.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                              : session.email
                                ? session.email[0].toUpperCase()
                                : 'U'}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold">
                        {role === 'COMPANY' ? <Building className="w-3.5 h-3.5 inline mr-1 text-slate-400" /> : <User className="w-3.5 h-3.5 inline mr-1 text-slate-400" />}
                        {session.name || 'My Profile'}
                      </span>
                    </Link>

                    <button
                      onClick={() => {
                        setNavMenuOpen(false)
                        toggleMobileView()
                      }}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200 text-left cursor-pointer"
                    >
                      {isMobileView ? <Monitor className="w-4 h-4 text-slate-400" /> : <Smartphone className="w-4 h-4 text-slate-400" />}
                      <span className="text-xs font-semibold">{isMobileView ? 'Switch to Desktop View' : 'Preview Mobile View'}</span>
                    </button>

                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 p-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-left cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-xs font-semibold">Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}