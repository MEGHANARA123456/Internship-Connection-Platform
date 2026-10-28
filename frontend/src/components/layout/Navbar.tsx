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
  Loader2,
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
import { BottomTabBar } from './BottomTabBar'
import { Logo } from './Logo'
import { routes } from '../../lib/routes'

type StudentCounts = {
  unread_notifications: number
  invites_new: number
  application_updates: number
  saved: number
}

type SearchItem = { id: number; title: string; subtitle: string; badge: string; url: string }
type SearchGroup = { type: string; label: string; items: SearchItem[] }

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
    { label: 'Audit Logs', url: routes.adminAuditLogs() },
  ],
}

function GlobalSearch({ role }: { role: NavigationRole }) {
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const desktopInputRef = useRef<HTMLInputElement>(null)
  const mobileInputRef = useRef<HTMLInputElement>(null)
  const isMobileViewport = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 767px)').matches : false
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retryCount, setRetryCount] = useState(0)

  const options = groups.flatMap((group) => group.items)
  const quick = role !== 'GUEST' ? quickLinks[role] : []

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : document.activeElement
      const typing = target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const useMobile = isMobileViewport()
        setOpen(true)
        setMobileOpen(useMobile)
        window.setTimeout(() => (useMobile ? mobileInputRef : desktopInputRef).current?.focus(), 0)
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const useMobile = isMobileViewport()
        setOpen(true)
        setMobileOpen(useMobile)
        window.setTimeout(() => (useMobile ? mobileInputRef : desktopInputRef).current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (open && !rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (!open || term.length < 2) {
      setGroups([])
      setError(false)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(false)
      api.get('/search', { params: { q: term, limit: 5 }, signal: controller.signal })
        .then((response) => setGroups(Array.isArray(response.data?.groups) ? response.data.groups : []))
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            console.error('Global search request failed.', requestError)
            setError(true)
            setGroups([])
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, open, retryCount])

  useEffect(() => {
    setActiveIndex(-1)
  }, [query, groups])

  const focusSearch = () => {
    const useMobile = isMobileViewport()
    setOpen(true)
    setMobileOpen(useMobile)
    window.setTimeout(() => (useMobile ? mobileInputRef : desktopInputRef).current?.focus(), 0)
  }

  const close = () => {
    setOpen(false)
    setMobileOpen(false)
    setActiveIndex(-1)
  }

  const choose = (url: string) => {
    navigate(url)
    close()
    setQuery('')
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = query.trim().length < 2 ? quick.length : options.length
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown' && count) {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % count)
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? count - 1 : index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (query.trim().length < 2) {
        const selected = quick[activeIndex >= 0 ? activeIndex : 0]
        if (selected) choose(selected.url)
      } else {
        const selected = options[activeIndex >= 0 ? activeIndex : 0]
        if (selected) choose(selected.url)
      }
    }
  }

  const input = (ref: React.RefObject<HTMLInputElement | null>) => (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={ref}
        role="combobox"
        aria-label="Search InternSphere"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-activedescendant={activeIndex >= 0 ? `global-search-option-${activeIndex}` : undefined}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={handleInputKeyDown}
        placeholder="Search…"
        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900 dark:focus:ring-indigo-950"
      />
      {loading
        ? <Loader2 aria-label="Searching" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-indigo-500" />
        : null}
    </div>
  )

  const results = (
    <div id="global-search-results" role="listbox" aria-label="Search results" className="max-h-[65vh] overflow-y-auto">
      {query.trim().length < 2 ? (
        <div className="p-3">
          <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Quick links</p>
          {quick.map((link, index) => (
            <button key={link.label} id={`global-search-option-${index}`} role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(link.url)} className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-indigo-50 aria-selected:bg-indigo-50 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-selected:bg-slate-800">
              <span className="flex-1">{link.label}</span><span className="text-xs text-slate-400">Open</span>
            </button>
          ))}
        </div>
      ) : loading ? (
        <div role="status" className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Searching…</div>
      ) : error ? (
        <div className="p-5 text-center text-sm text-rose-600 dark:text-rose-400">
          <p>Search couldn’t be completed.</p>
          <button type="button" onClick={() => setRetryCount((count) => count + 1)} className="mt-2 font-semibold underline">Retry</button>
        </div>
      ) : options.length === 0 ? (
        <p className="p-5 text-center text-sm text-slate-500">No results for “{query.trim()}”.</p>
      ) : (
        <div className="p-2">
          {groups.map((group) => (
            <section key={group.type} aria-label={group.label} className="mb-2 last:mb-0">
              <h3 className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group.label}</h3>
              {group.items.map((item) => {
                const index = options.indexOf(item)
                return (
                  <button key={`${group.type}-${item.id}`} id={`global-search-option-${index}`} role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item.url)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-indigo-50 aria-selected:bg-indigo-50 dark:hover:bg-slate-800 dark:aria-selected:bg-slate-800">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</span><span className="block truncate text-xs text-slate-500">{item.subtitle}</span></span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{item.badge}</span>
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )

  if (role === 'GUEST') return null

  return (
    <div ref={rootRef} className="relative flex flex-1 justify-center px-3 md:px-6">
      <div className="hidden w-full max-w-xl md:block">
        {input(desktopInputRef)}
        {open && <div className="absolute left-3 right-3 top-full z-[60] mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 md:left-6 md:right-6">{results}</div>}
      </div>
      <button type="button" onClick={focusSearch} aria-label="Open search" className="absolute right-0 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden">
        <Search className="h-5 w-5" />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-[80] bg-white p-4 dark:bg-slate-950 md:hidden">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex-1">{input(mobileInputRef)}</div>
            <button type="button" aria-label="Close search" onClick={close} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">{results}</div>
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
  const countFor = useCallback((source?: NavigationCountSource) => {
    if (source === 'invites_new') return studentNavCounts.invites_new
    if (source === 'application_updates') return studentNavCounts.application_updates
    if (source === 'saved') return studentNavCounts.saved
    if (source === 'notifications') return unreadCount
    return 0
  }, [studentNavCounts, unreadCount])

  useWebSocketChat(session?.userId)

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
    void refresh()
    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('app:notification', handleNotification)
    return () => {
      mounted = false
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('app:notification', handleNotification)
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
    if (item.action === 'view-mode' && (window.self !== window.top || new URLSearchParams(location.search).has('preview'))) return null
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
        ? (isMobileView ? 'Exit screen preview' : 'Screen preview')
        : item.action === 'sign-out' ? 'Sign out' : item.label
      const ActionIcon = item.action === 'view-mode' ? (isMobileView ? Monitor : Smartphone) : Icon
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
          {session && <GlobalSearch role={role} />}
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
                  {config.hamburger.map((item) => renderItem(item))}
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
