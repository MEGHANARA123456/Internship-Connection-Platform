import { useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from '../../store/auth'
import { api, getFullMediaUrl } from '../../api/client'
import { Sun, Sunset, Moon, Calendar, ShieldCheck } from 'lucide-react'

interface WelcomeGreetingProps {
  name?: string
  role?: string
  customSubtitle?: string
  actionNode?: ReactNode
  showDate?: boolean
  compact?: boolean
  className?: string
}

function getTimeGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    return { greeting: 'Good morning', icon: Sun, color: 'text-amber-500' }
  }
  if (hour >= 12 && hour < 17) {
    return { greeting: 'Good afternoon', icon: Sun, color: 'text-amber-500' }
  }
  if (hour >= 17 && hour < 22) {
    return { greeting: 'Good evening', icon: Sunset, color: 'text-orange-500' }
  }
  return { greeting: 'Welcome back', icon: Moon, color: 'text-indigo-400' }
}

function getInitials(name: string): string {
  if (!name) return 'IS'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function WelcomeGreeting({
  name: propName,
  role: propRole,
  customSubtitle,
  actionNode,
  showDate = true,
  compact = false,
  className = '',
}: WelcomeGreetingProps) {
  const { session, updateName } = useAuthStore()
  const [resolvedName, setResolvedName] = useState<string>(() => {
    if (propName) return propName
    if (session?.name) return session.name
    if (session?.email) {
      const raw = session.email.split('@')[0].split('.')[0]
      const clean = raw.replace(/[^a-zA-Z]/g, ' ').trim()
      return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : raw
    }
    return ''
  })

  const currentRole = propRole || session?.role || 'STUDENT'
  const { greeting, icon: GreetingIcon, color: iconColor } = getTimeGreeting()

  // Background fetch user profile if session.name isn't populated yet
  useEffect(() => {
    if (propName) {
      setResolvedName(propName)
      return
    }

    if (session?.name) {
      setResolvedName(session.name)
      return
    }

    if (session?.accessToken) {
      api
        .get('/auth/me')
        .then((res) => {
          if (res.data?.name) {
            setResolvedName(res.data.name)
            updateName(res.data.name)
          }
        })
        .catch(() => {
          // Fallback gracefully to email-derived name
        })
    }
  }, [propName, session?.name, session?.accessToken, updateName])

  // Formatted date string
  const todayFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date())

  // Default subtitle by role
  const defaultSubtitle = {
    STUDENT: 'Ready to advance your career? Browse verified internships and track your applications.',
    COMPANY: 'Welcome to your hiring command center. Review candidates, schedule interviews, and publish open roles.',
    ADMIN: 'Platform operations dashboard. Oversee company verification, listing moderation, and ecosystem security.',
    COLLEGE: 'Institutional placement portal. Track student career progress and corporate recruiter connections.',
  }[currentRole] || 'Welcome back to your dashboard.'

  const displayName = resolvedName || (currentRole === 'COMPANY' ? 'Recruiter' : currentRole === 'ADMIN' ? 'Administrator' : 'Student')
  const initials = getInitials(displayName)
  const avatarFullUrl = getFullMediaUrl(session?.avatar_url)

  const roleLabel =
    currentRole === 'STUDENT'
      ? 'Verified Student'
      : currentRole === 'COMPANY'
      ? 'Registered Employer'
      : currentRole === 'ADMIN'
      ? 'System Admin'
      : 'Campus Partner'

  if (compact) {
    return (
      <div className={`flex items-center justify-between gap-3 p-3 rounded-xl bg-gradient-to-r from-indigo-50/70 via-white to-purple-50/50 dark:from-slate-800/80 dark:via-slate-900 dark:to-indigo-950/40 border border-slate-200/80 dark:border-slate-800 shadow-2xs ${className}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
            {avatarFullUrl ? (
              <img
                src={avatarFullUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  ;(e.currentTarget as HTMLElement).style.display = 'none'
                }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate">
              <GreetingIcon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{greeting},</span>
              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">{displayName}!</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{customSubtitle || defaultSubtitle}</p>
          </div>
        </div>
        {actionNode && <div className="shrink-0">{actionNode}</div>}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/40 dark:from-slate-900 dark:via-slate-900/90 dark:to-indigo-950/40 border border-indigo-100/80 dark:border-slate-800 shadow-xs transition-all ${className}`}>
      {/* Subtle decorative background glow */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-indigo-400/10 dark:bg-indigo-500/10 blur-2xl pointer-events-none" />

      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-3.5">
        {/* Main Content Area */}
        <div className="flex items-start gap-3 min-w-0">
          {/* Avatar */}
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-600 text-white flex items-center justify-center font-bold text-sm shadow-sm shadow-indigo-500/25 ring-2 ring-white dark:ring-slate-800 shrink-0 mt-0.5">
            {avatarFullUrl ? (
              <img
                src={avatarFullUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  ;(e.currentTarget as HTMLElement).style.display = 'none'
                }}
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>

          {/* Text block */}
          <div className="space-y-1 min-w-0 flex-1">
            {/* Meta Tags Row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-semibold bg-white/90 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 shadow-2xs">
                <GreetingIcon className={`w-3 h-3 ${iconColor}`} />
                <span>{greeting}</span>
              </span>

              {showDate && (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                  <Calendar className="w-2.5 h-2.5" />
                  <span>{todayFormatted}</span>
                </span>
              )}

              {/* Role Chip integrated directly for mobile flow */}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-semibold bg-indigo-100/70 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60 ml-auto sm:ml-0">
                <ShieldCheck className="w-3 h-3" />
                <span>{roleLabel}</span>
              </span>
            </div>

            {/* Title / Name */}
            <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
              <span>{greeting},</span>
              <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 dark:from-indigo-400 dark:to-violet-400 bg-clip-text text-transparent truncate max-w-[220px] sm:max-w-md">
                {displayName}
              </span>
              <span className="inline-block text-sm sm:text-base">👋</span>
            </h2>

            {/* Subtitle */}
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed line-clamp-2 sm:line-clamp-none">
              {customSubtitle || defaultSubtitle}
            </p>
          </div>
        </div>

        {/* Action Button if provided */}
        {actionNode && (
          <div className="flex items-center gap-2 self-start md:self-center shrink-0 pt-1 md:pt-0">
            {actionNode}
          </div>
        )}
      </div>
    </div>
  )
}
