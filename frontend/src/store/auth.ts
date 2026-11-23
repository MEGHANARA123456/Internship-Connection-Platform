import { create } from 'zustand'
import { clearUserCaches } from '../lib/queryClient'

export type UserRole = 'STUDENT' | 'COMPANY' | 'ADMIN'

export type Session = {
  accessToken: string
  refreshToken: string
  role: UserRole
  userId?: number
  email?: string
  name?: string
  avatar_url?: string | null
  accessTokenExpiresAt?: string | null
  refreshTokenExpiresAt?: string | null
  accessTokenExpiresIn?: number | null
  refreshTokenExpiresIn?: number | null
} | null

export type SessionPersistence = 'session' | 'local'

export const USER_SCOPED_KEYS = [
  'internsphere_resume_builder',
  'student_github_handle',
  'student_leetcode_handle',
  'internsphere_recent_searches',
]
const SESSION_KEY = 'session'
const SESSION_CHANGED_NOTICE_KEY = 'session_changed_notice'
const LOGOUT_SYNC_KEY = 'auth_logout_event'
const LEGACY_SKILL_BADGES_MIGRATION_KEY = 'student_skill_badges_migrated_v1'

if (typeof window !== 'undefined') {
  localStorage.removeItem('student_recommendations')
  if (localStorage.getItem(LEGACY_SKILL_BADGES_MIGRATION_KEY) !== 'true') {
    localStorage.removeItem('student_verified_badges')
    localStorage.setItem(LEGACY_SKILL_BADGES_MIGRATION_KEY, 'true')
  }
}

type AuthState = {
  session: Session
  persistence: SessionPersistence
  authInitialized: boolean
  authChecking: boolean
  sessionChangedInAnotherTab: boolean
  signedOutDeliberately: boolean
  setSession: (session: Session, persistence?: SessionPersistence) => void
  setAuthCheckState: (checking: boolean, initialized?: boolean) => void
  updateName: (name: string) => void
  updateAvatar: (avatar_url: string | null) => void
  logout: (deliberate?: boolean, syncAcrossTabs?: boolean) => void
  clearSessionChangedNotice: () => void
  clearSignedOutDeliberately: () => void
}

function removeUserScopedData() {
  USER_SCOPED_KEYS.forEach((key) => localStorage.removeItem(key))
}

function sessionsHaveDifferentUsers(current: Session, next: Session): boolean {
  if (!current || !next) return false
  if (
    (current.userId != null || next.userId != null) &&
    current.userId !== next.userId
  ) {
    return true
  }
  const currentEmail = current.email?.trim().toLowerCase()
  const nextEmail = next.email?.trim().toLowerCase()
  return Boolean(
    ((currentEmail || nextEmail) && currentEmail !== nextEmail) ||
    current.role !== next.role,
  )
}

function readStoredSession(storage: Storage): Session {
  try {
    const stored = storage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) as Session : null
  } catch {
    return null
  }
}

function getInitialSession(): { session: Session; persistence: SessionPersistence } {
  const tabSession = readStoredSession(sessionStorage)
  if (tabSession) return { session: tabSession, persistence: 'session' }
  const persistentSession = readStoredSession(localStorage)
  if (persistentSession) return { session: persistentSession, persistence: 'local' }
  return { session: null, persistence: 'session' }
}

function storageFor(persistence: SessionPersistence): Storage {
  return persistence === 'local' ? localStorage : sessionStorage
}

function storedSessionMatches(
  session: Exclude<Session, null>,
  persistence: SessionPersistence,
): boolean {
  const storedSession = readStoredSession(storageFor(persistence))
  return storedSession?.userId === session.userId
}

const initialSession = getInitialSession()

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialSession,
  authInitialized: !initialSession.session,
  authChecking: false,
  sessionChangedInAnotherTab: sessionStorage.getItem(SESSION_CHANGED_NOTICE_KEY) === 'true',
  signedOutDeliberately: false,
  setSession: (session, requestedPersistence) => {
    const current = get().session
    const persistence = requestedPersistence ?? get().persistence
    if ((session && !current) || sessionsHaveDifferentUsers(current, session)) {
      removeUserScopedData()
      clearUserCaches()
    }
    const storage = storageFor(persistence)
    if (session) {
      storage.setItem(SESSION_KEY, JSON.stringify(session))
      if (persistence === 'local') sessionStorage.removeItem(SESSION_KEY)
    } else {
      storage.removeItem(SESSION_KEY)
      removeUserScopedData()
      clearUserCaches()
    }
    set({
      session,
      persistence,
      authInitialized: true,
      authChecking: false,
      signedOutDeliberately: false,
    })
  },
  setAuthCheckState: (checking, initialized = false) => {
    set({ authChecking: checking, authInitialized: initialized || get().authInitialized })
  },
  updateName: (name) => {
    const { session, persistence } = get()
    if (session && storedSessionMatches(session, persistence)) {
      const updated = { ...session, name }
      storageFor(persistence).setItem(SESSION_KEY, JSON.stringify(updated))
      set({ session: updated })
    }
  },
  updateAvatar: (avatar_url) => {
    const { session, persistence } = get()
    if (session && storedSessionMatches(session, persistence)) {
      const updated = { ...session, avatar_url }
      storageFor(persistence).setItem(SESSION_KEY, JSON.stringify(updated))
      set({ session: updated })
    }
  },
  logout: (deliberate = true, syncAcrossTabs = true) => {
    storageFor(get().persistence).removeItem(SESSION_KEY)
    removeUserScopedData()
    clearUserCaches()
    sessionStorage.removeItem(SESSION_CHANGED_NOTICE_KEY)
    if (syncAcrossTabs) {
      localStorage.setItem(LOGOUT_SYNC_KEY, `${Date.now()}-${performance.now()}`)
    }
    set({
      session: null,
      persistence: 'session',
      authInitialized: true,
      authChecking: false,
      sessionChangedInAnotherTab: false,
      signedOutDeliberately: deliberate,
    })
  },
  clearSessionChangedNotice: () => {
    sessionStorage.removeItem(SESSION_CHANGED_NOTICE_KEY)
    set({ sessionChangedInAnotherTab: false })
  },
  clearSignedOutDeliberately: () => {
    set({ signedOutDeliberately: false })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    const state = useAuthStore.getState()
    if (event.key === LOGOUT_SYNC_KEY && state.session) {
      state.logout(false, false)
      sessionStorage.setItem(SESSION_CHANGED_NOTICE_KEY, 'true')
      useAuthStore.setState({ sessionChangedInAnotherTab: true })
      return
    }
    if (event.key !== SESSION_KEY || event.storageArea !== localStorage) return

    const { session: current, persistence } = state
    if (persistence !== 'local') return

    let nextSession: Session = null
    try {
      nextSession = event.newValue ? JSON.parse(event.newValue) as Session : null
    } catch {
      nextSession = null
    }

    if (current && !nextSession) {
      state.logout(false, false)
      sessionStorage.setItem(SESSION_CHANGED_NOTICE_KEY, 'true')
      useAuthStore.setState({ sessionChangedInAnotherTab: true })
      return
    }

    if (sessionsHaveDifferentUsers(current, nextSession)) {
      removeUserScopedData()
      clearUserCaches()
      sessionStorage.setItem(SESSION_CHANGED_NOTICE_KEY, 'true')
      useAuthStore.setState({
        session: null,
        authInitialized: true,
        authChecking: false,
        sessionChangedInAnotherTab: true,
        signedOutDeliberately: false,
      })
      return
    }

    useAuthStore.setState({ session: nextSession })
  })
}
