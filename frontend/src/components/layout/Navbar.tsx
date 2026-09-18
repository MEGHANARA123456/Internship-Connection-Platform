import { useState, useEffect, useRef } from 'react'
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
  LayoutGrid,
  ChevronDown,
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
  const [mobileOpen, setMobileOpen] = useState(false)
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const navMenuRef = useRef<HTMLDivElement>(null)

  // Handle click outside and Escape key to close navigation menu
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
      if (e.key === 'Escape') {
        setNavMenuOpen(false)
      }
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

        {/* Desktop Navigation Links & Menu Dropdown */}
        <nav className="hidden md:flex items-center gap-1.5">
          {/* Interactive Navigation Menu Dropdown */}
          <div className="relative" ref={navMenuRef}>
            <button
              type="button"
              onClick={() => setNavMenuOpen((prev) => !prev)}
              title="Quick Navigation & Features Menu"
              className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 border shadow-2xs ${
                navMenuOpen
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo-200 dark:shadow-none'
                  : 'bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60'
              }`}
              aria-label="Portal Navigation Menu"
              aria-expanded={navMenuOpen}
            >
              <LayoutGrid className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Menu</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${navMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Floating Drawer */}
            {navMenuOpen && (
              <div className="absolute left-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                {/* Menu Header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5 px-1">
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">Portal Navigation</h4>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Direct access to all platform workflows</p>
                    </div>
                  </div>
                  {role ? (
                    <Badge status={role} className="text-[10px] py-0.5 px-1.5">
                      {role}
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">Guest</span>
                  )}
                </div>

                {/* Role-Specific Links */}
                <div className="space-y-1">
                  {role === 'STUDENT' && (
                    <>
                      <Link
                        to="/applications"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/applications')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">My Applications</span>
                            <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">Active Pipeline</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Track recruitment stages, status changes & offers</p>
                        </div>
                      </Link>

                      <Link
                        to="/opportunities"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/opportunities')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Find Internships</span>
                            <span className="text-[10px] text-slate-400">Verified</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Browse verified opportunities with direct applications</p>
                        </div>
                      </Link>

                      <Link
                        to="/interviews"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/interviews')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Interviews</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Meetings</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">View scheduled timeslots and recruiter meetings</p>
                        </div>
                      </Link>

                      <Link
                        to="/messages"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/messages')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/60 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Messages & Chat</span>
                            <span className="text-[10px] text-violet-600 dark:text-violet-400">Live</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Real-time chat with employers and recruiters</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link
                          to="/saved"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <Bookmark className="w-3.5 h-3.5 text-amber-500" />
                          <span>Saved Jobs</span>
                        </Link>
                        <Link
                          to="/college"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Placement Hub</span>
                        </Link>
                        <Link
                          to="/profile/student"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <User className="w-3.5 h-3.5 text-blue-500" />
                          <span>My Profile</span>
                        </Link>
                        <Link
                          to="/student"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Analytics</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {role === 'COMPANY' && (
                    <>
                      <Link
                        to="/company/jobs"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/company/jobs')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Our Job Listings</span>
                            <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">Postings</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage active postings, applicants and drafts</p>
                        </div>
                      </Link>

                      <Link
                        to="/company/internships/new"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/company/internships/new')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <PlusCircle className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Post an Internship</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">+ New</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Create and publish verified internship opportunities</p>
                        </div>
                      </Link>

                      <Link
                        to="/interviews"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/interviews')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Interviews</span>
                            <span className="text-[10px] text-blue-600 dark:text-blue-400">Scheduling</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage and coordinate candidate interview meetings</p>
                        </div>
                      </Link>

                      <Link
                        to="/messages"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/messages')
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/60 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Messages</span>
                            <span className="text-[10px] text-violet-600 dark:text-violet-400">Chat</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Communicate directly with shortlisted students</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link
                          to="/profile/company"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <Building className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Company Profile</span>
                        </Link>
                        <Link
                          to="/company"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Analytics</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {role === 'ADMIN' && (
                    <>
                      <Link
                        to="/admin"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/admin')
                            ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Admin Console</span>
                            <span className="text-[10px] text-purple-600 dark:text-purple-400">Overview</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Platform ecosystem metrics & system health</p>
                        </div>
                      </Link>

                      <Link
                        to="/admin/users"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/admin/users')
                            ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Users Management</span>
                            <span className="text-[10px] text-blue-600 dark:text-blue-400">Vetting</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Manage students, recruiters and admin accounts</p>
                        </div>
                      </Link>

                      <Link
                        to="/admin/verifications"
                        onClick={() => setNavMenuOpen(false)}
                        className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                          isActive('/admin/verifications')
                            ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">Company Verifications</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Approvals</span>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Review and approve employer documentation</p>
                        </div>
                      </Link>

                      <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                        <Link
                          to="/admin/moderation"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <Briefcase className="w-3.5 h-3.5 text-purple-500" />
                          <span>Jobs Queue</span>
                        </Link>
                        <Link
                          to="/admin/reports"
                          onClick={() => setNavMenuOpen(false)}
                          className="flex items-center gap-1.5 p-1.5 px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                          <span>Disputes</span>
                        </Link>
                      </div>
                    </>
                  )}

                  {!session && (
                    <>
                      <Link
                        to="/opportunities"
                        onClick={() => setNavMenuOpen(false)}
                        className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200"
                      >
                        <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5">
                          <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">Browse Internships</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Explore openings across top employers</p>
                        </div>
                      </Link>

                      <Link
                        to="/college"
                        onClick={() => setNavMenuOpen(false)}
                        className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200"
                      >
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5">
                          <GraduationCap className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold">College Placement Portal</span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Institutional campus placements</p>
                        </div>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

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
