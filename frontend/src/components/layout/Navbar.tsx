import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  Briefcase,
  Check,
  ChevronDown,
  Menu,
  Moon,
  Monitor,
  Search,
  Smartphone,
  X,
  Sun,
} from 'lucide-react'
import { api } from '../../api/client'
import { isSensitiveNotification } from '../../lib/notifications'
import { applicationStatusMenuItems, navigationConfig, type NavigationCountSource, type NavigationItem, type NavigationRole } from '../../lib/navConfig'
import { useAuthStore } from '../../store/auth'
import { useThemeStore } from '../../store/theme'
import { useViewModeStore } from '../../store/viewMode'
import { useWebSocketChat } from '../../lib/useWebSocketChat'
import { Badge } from '../ui/Badge'
import { SearchBox, type SearchSuggestion } from '../ui/SearchBox'
import { BottomTabBar } from './BottomTabBar'
import { Logo } from './Logo'
import { routes } from '../../lib/routes'

type StudentCounts = {
  unread_notifications: number
  invites_new: number
  application_updates: number
  saved: number
}

const quickLinks: Record<Exclude<NavigationRole, 'GUEST'>, Array<{ label: string; url: string }>> = {
  STUDENT: [
    { label: 'Applications', url: routes.applications() },
    { label: 'Saved', url: routes.saved },
    { label: 'Interviews', url: routes.interviews({ tab: 'upcoming' }) },
    { label: 'Privacy & Security', url: routes.privacySecurity },
  ],
  COMPANY: [
    { label: 'My roles', url: routes.companyJobs() },
    { label: 'Applicants', url: routes.companyApplicants() },
    { label: 'Interviews', url: routes.interviews({ tab: 'upcoming' }) },
  ],
  ADMIN: [
    { label: 'Notifications & Mailbox', url: routes.notifications },
    { label: 'Skill assessments', url: routes.adminSkills },
    { label: 'Verifications', url: routes.adminVerifications },
    { label: 'Users', url: routes.adminUsers() },
    { label: 'Students', url: routes.adminStudents() },
    { label: 'Companies', url: routes.adminCompanies },
    { label: 'Audit Logs', url: routes.adminAuditLogs() },
  ],
}

const previewMobileItem: NavigationItem = {
  id: 'preview-mobile-view',
  label: 'Preview Mobile View',
  icon: Smartphone,
  action: 'view-mode',
}

function GlobalSearch({ role }: { role: NavigationRole }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const quick: SearchSuggestion[] = role === 'GUEST'
    ? []
    : quickLinks[role].map((link, index) => ({
      id: index,
      text: link.label,
      kind: 'link',
      subtitle: 'Quick link',
      url: link.url,
      match_text: link.label,
    }))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement
      const typing = target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileOpen(window.innerWidth < 768)
        document.querySelector<HTMLInputElement>('[aria-label="Search InternSphere"]')?.focus()
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setMobileOpen(window.innerWidth < 768)
        document.querySelector<HTMLInputElement>('[aria-label="Search InternSphere"]')?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const choose = (suggestion: SearchSuggestion) => {
    if (suggestion.url) navigate(suggestion.url)
    setQuery('')
    setMobileOpen(false)
  }
  const scope = role === 'STUDENT' ? 'all' : role === 'COMPANY' ? 'postings' : 'all'
  const searchBox = () => (
    <SearchBox
      ariaLabel="Search InternSphere"
      value={query}
      onChange={setQuery}
      onSelect={choose}
      scope={scope}
      placeholder="Search…"
      staticSuggestions={quick}
      className="h-10 rounded-xl bg-slate-50 dark:bg-slate-800"
    />
  )
  return (
    <div className="relative flex flex-1 justify-center px-3 md:px-6">
      <div className="hidden w-full max-w-xl md:block">{searchBox()}</div>
      <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open search" className="absolute right-0 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden">
        <Search className="h-5 w-5" />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] bg-white p-4 dark:bg-slate-950 md:hidden">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1">{searchBox()}</div>
            <button type="button" aria-label="Close search" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Navbar() {
  const { session, logout } = useAuthStore()
  const { setTheme, isDark } = useThemeStore()
  const { isMobileView, toggleMobileView } = useViewModeStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [unreadCount, setUnreadCount] = useState(0)
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const [internshipsMenuOpen, setInternshipsMenuOpen] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 768)
  const [studentNavCounts, setStudentNavCounts] = useState<StudentCounts>({
    unread_notifications: 0,
    invites_new: 0,
    application_updates: 0,
    saved: 0,
  })
  const navMenuRef = useRef<HTMLDivElement>(null)
  const internshipsMenuRef = useRef<HTMLDivElement>(null)

  const role: NavigationRole = session?.role ?? 'GUEST'
  const config = navigationConfig[role]
  const hamburgerItems = role === 'COMPANY'
    ? config.hamburger.flatMap((item) => item.action === 'sign-out' ? [previewMobileItem, item] : [item])
    : config.hamburger
  const countFor = useCallback((source?: NavigationCountSource) => {
    if (source === 'invites_new') return studentNavCounts.invites_new
    if (source === 'application_updates') return studentNavCounts.application_updates
    if (source === 'saved') return studentNavCounts.saved
    if (source === 'notifications') return unreadCount
    return 0
  }, [studentNavCounts, unreadCount])

  useWebSocketChat(session?.userId)

  useEffect(() => {
    const updateViewport = () => setIsDesktopViewport(window.innerWidth >= 768)
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    if (!session?.accessToken) {
      setUnreadCount(0)
      setStudentNavCounts({
        unread_notifications: 0,
        invites_new: 0,
        application_updates: 0,
        saved: 0,
      })
      return
    }
    let mounted = true
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await api.get('/navigation/counts')
        if (mounted) {
          setUnreadCount(Number(res.data?.unread_notifications || 0))
          setStudentNavCounts({
            unread_notifications: Number(res.data?.unread_notifications || 0),
            invites_new: Number(res.data?.invites_new || 0),
            application_updates: Number(res.data?.application_updates || 0),
            saved: Number(res.data?.saved || 0),
          })
        }
      } catch (error) {
        console.error('Failed to refresh navigation counts:', error)
      }
    }
    const handleNotification = (event: Event) => {
      const notification = (event as CustomEvent).detail
      if (notification && !isSensitiveNotification(notification)) {
        setUnreadCount((count) => count + 1)
      }
      void refresh()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const handleCountsRefresh = () => void refresh()
    void refresh()
    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('app:notification', handleNotification)
    window.addEventListener('app:navigation-counts-refresh', handleCountsRefresh)
    return () => {
      mounted = false
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('app:notification', handleNotification)
      window.removeEventListener('app:navigation-counts-refresh', handleCountsRefresh)
    }
  }, [session?.accessToken, role, location.pathname])

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      const target = event.target as Node
      if (navMenuOpen && !navMenuRef.current?.contains(target)) setNavMenuOpen(false)
      if (internshipsMenuOpen && !internshipsMenuRef.current?.contains(target)) {
        setInternshipsMenuOpen(false)
        setStatusMenuOpen(false)
      }
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavMenuOpen(false)
        setInternshipsMenuOpen(false)
        setStatusMenuOpen(false)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const menu = (event.target as HTMLElement).closest('[role="menu"]')
      if (!menu) return
      const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      if (items.length === 0) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(current + step + items.length) % items.length].focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [navMenuOpen, internshipsMenuOpen])

  const handleSignOut = () => {
    setNavMenuOpen(false)
    logout()
    navigate(routes.login())
  }

  const handleAction = (item: NavigationItem) => {
    if (item.action === 'cookie-preferences') window.dispatchEvent(new Event('open:cookie-preferences'))
    if (item.action === 'view-mode') toggleMobileView()
    if (item.action === 'sign-out') handleSignOut()
    setNavMenuOpen(false)
  }

  const rowClass = (path?: string) =>
    `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
      path && location.pathname === path
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
    }`

  const countChip = (item: NavigationItem) => {
    const count = countFor(item.countSource)
    return count > 0 ? <span className="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">{item.countSource === 'invites_new' ? `${count} New` : count}</span> : null
  }

  const renderItem = (item: NavigationItem, mobileTop = false) => {
    const Icon = item.icon
    if (item.action === 'view-mode' && (
      ((role === 'COMPANY' || role === 'ADMIN') && !isDesktopViewport)
      || window.self !== window.top
      || new URLSearchParams(location.search).has('preview')
    )) return null
    if (item.id === 'application-status') {
      return (
        <div key={item.id} className="space-y-1">
          <button
            type="button"
            role="menuitem"
            aria-expanded={statusMenuOpen}
            onClick={() => setStatusMenuOpen((value) => !value)}
            className={rowClass('/applications')}
          >
            <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
            <span className="min-w-0 flex-1">{item.label}</span>
            {countChip(item)}
            <ChevronDown className={`h-4 w-4 transition-transform ${statusMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {statusMenuOpen && (
            <div className="ml-7 border-l border-slate-200 pl-2 dark:border-slate-700">
              {applicationStatusMenuItems.map((status) => {
                const path = status.query ? `/applications?status=${status.query}` : '/applications'
                const requested = (new URLSearchParams(location.search).get('status') || 'all').toUpperCase()
                const currentStatus = requested === 'INTERVIEW_SCHEDULED' ? 'INTERVIEW' : requested
                const active = location.pathname === '/applications' && currentStatus === status.key
                return (
                  <Link key={status.key} to={path} role="menuitem" onClick={() => {
                    setStatusMenuOpen(false)
                    setInternshipsMenuOpen(false)
                    setNavMenuOpen(false)
                    setStudentNavCounts((counts) => ({ ...counts, application_updates: 0 }))
                  }} className={`${rowClass(path)} py-2 text-xs`}>
                    <span className="flex-1">{status.label}</span>
                    {active && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )
    }
    if (item.action) {
      const label = item.action === 'view-mode'
        ? (role === 'COMPANY' || role === 'ADMIN'
          ? 'Preview Mobile View'
          : isMobileView ? 'Exit screen preview' : 'Screen preview')
        : item.action === 'sign-out' ? 'Sign out' : item.label
      const ActionIcon = item.action === 'view-mode'
        ? (role === 'COMPANY' || role === 'ADMIN' ? Smartphone : isMobileView ? Monitor : Smartphone)
        : Icon
      return (
        <button key={item.id} type="button" role="menuitem" onClick={() => handleAction(item)} className={rowClass()}>
          <ActionIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="flex-1">{label}</span>
        </button>
      )
    }
    return (
      <Link
        key={item.id}
        to={item.route || '/'}
        role="menuitem"
        onClick={() => {
          setNavMenuOpen(false)
          setInternshipsMenuOpen(false)
          if (item.countSource === 'notifications') setUnreadCount(0)
          if (item.countSource === 'invites_new') setStudentNavCounts((counts) => ({ ...counts, invites_new: 0 }))
          if (item.countSource === 'application_updates') setStudentNavCounts((counts) => ({ ...counts, application_updates: 0 }))
        }}
        className={rowClass(item.route?.split('?')[0])}
      >
        <Icon className="h-4 w-4 shrink-0 text-indigo-500" />
        <span className="min-w-0 flex-1">{item.label}</span>
        {countChip(item)}
        {mobileTop && item.id === 'application-status' && <ChevronDown className="h-4 w-4" />}
      </Link>
    )
  }

  const topBadge = studentNavCounts.invites_new + studentNavCounts.application_updates

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 shadow-2xs backdrop-blur-xs transition-colors dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex min-h-[4rem] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            {session && <Badge status={session.role} className="px-2 py-0.5 text-[11px] font-semibold">{session.role}</Badge>}
          </div>
          <GlobalSearch role={role} />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="cursor-pointer rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-slate-600 dark:text-slate-300" />}
            </button>
            {session?.role === 'STUDENT' && (
              <div className="relative hidden md:block" ref={internshipsMenuRef}>
                <button
                  type="button"
                  onMouseEnter={() => setInternshipsMenuOpen(true)}
                  onClick={() => setInternshipsMenuOpen((value) => !value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown') return
                    event.preventDefault()
                    setInternshipsMenuOpen(true)
                    window.requestAnimationFrame(() => internshipsMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
                  }}
                  aria-haspopup="menu"
                  aria-expanded={internshipsMenuOpen}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Briefcase className="h-4 w-4 text-indigo-500" />
                  Internships
                  {topBadge > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{topBadge}</span>}
                  <ChevronDown className={`h-4 w-4 transition-transform ${internshipsMenuOpen ? 'rotate-180' : ''}`} />
                </button>
                {internshipsMenuOpen && (
                  <div role="menu" aria-label="Internships" className="absolute right-0 top-full z-50 mt-2 max-h-[75vh] w-80 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                    {config.topBar.map((item) => renderItem(item))}
                  </div>
                )}
              </div>
            )}
            {session && role !== 'STUDENT' && (
              <Link to={routes.notifications} aria-label="Notifications & Mailbox" onClick={() => setUnreadCount(0)} className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </Link>
            )}
            <div className="relative" ref={navMenuRef}>
              <button
                type="button"
                onClick={() => setNavMenuOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown') return
                  event.preventDefault()
                  setNavMenuOpen(true)
                  window.requestAnimationFrame(() => navMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
                }}
                title="Menu"
                aria-label="Open navigation menu"
                aria-haspopup="menu"
                aria-expanded={navMenuOpen}
                className="cursor-pointer rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Menu className="h-6 w-6" />
              </button>
              {navMenuOpen && (
                <div role="menu" aria-label="Navigation" className="absolute right-0 top-full z-50 mt-2 max-h-[80vh] w-[min(24rem,calc(100vw-1.5rem))] space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-100 px-1 pb-2 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">Navigation</span>
                    {session ? <Badge status={session.role} className="px-1.5 py-0.5 text-[10px]">{session.role}</Badge> : <span className="text-[10px] text-slate-500">Guest</span>}
                  </div>
                  {role === 'STUDENT' && (
                    <div className="space-y-1 border-b border-slate-100 pb-2 dark:border-slate-800 md:hidden">
                      {config.topBar.map((item) => renderItem(item, true))}
                    </div>
                  )}
                  {hamburgerItems.map((item) => renderItem(item))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <BottomTabBar />
    </>
  )
}
