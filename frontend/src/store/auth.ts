import { create } from 'zustand'

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
  'student_verified_badges',
]
const SESSION_KEY = 'session'
const SESSION_CHANGED_NOTICE_KEY = 'session_changed_notice'

if (typeof window !== 'undefined') {
  localStorage.removeItem('student_recommendations')
}

type AuthState = {
  session: Session
  persistence: SessionPersistence
  sessionChangedInAnotherTab: boolean
  setSession: (session: Session, persistence?: SessionPersistence) => void
  updateName: (name: string) => void
  updateAvatar: (avatar_url: string | null) => void
  logout: () => void
  clearSessionChangedNotice: () => void
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
  sessionChangedInAnotherTab: sessionStorage.getItem(SESSION_CHANGED_NOTICE_KEY) === 'true',
  setSession: (session, requestedPersistence) => {
    const current = get().session
    const persistence = requestedPersistence ?? get().persistence
    if ((session && !current) || sessionsHaveDifferentUsers(current, session)) {
      removeUserScopedData()
    }
    const storage = storageFor(persistence)
    if (session) {
      storage.setItem(SESSION_KEY, JSON.stringify(session))
      if (persistence === 'local') sessionStorage.removeItem(SESSION_KEY)
    } else {
      storage.removeItem(SESSION_KEY)
      removeUserScopedData()
    }
    set({ session, persistence })
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
  logout: () => {
    storageFor(get().persistence).removeItem(SESSION_KEY)
    removeUserScopedData()
    set({ session: null, persistence: 'session' })
  },
  clearSessionChangedNotice: () => {
    sessionStorage.removeItem(SESSION_CHANGED_NOTICE_KEY)
    set({ sessionChangedInAnotherTab: false })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY || event.storageArea !== localStorage) return

    const { session: current, persistence } = useAuthStore.getState()
    if (persistence !== 'local') return

    let nextSession: Session = null
    try {
      nextSession = event.newValue ? JSON.parse(event.newValue) as Session : null
    } catch {
      nextSession = null
    }

    if (sessionsHaveDifferentUsers(current, nextSession) || (current && !nextSession)) {
      removeUserScopedData()
      sessionStorage.setItem(SESSION_CHANGED_NOTICE_KEY, 'true')
      useAuthStore.setState({
        session: null,
        sessionChangedInAnotherTab: true,
      })
      window.setTimeout(() => window.location.reload(), 1200)
      return
    }

    useAuthStore.setState({ session: nextSession })
  })
}
