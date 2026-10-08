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

export const USER_SCOPED_KEYS = [
  'internsphere_resume_builder',
  'student_github_handle',
  'student_leetcode_handle',
  'student_verified_badges',
  'student_recommendations',
]

type AuthState = {
  session: Session
  setSession: (session: Session) => void
  updateName: (name: string) => void
  updateAvatar: (avatar_url: string | null) => void
  logout: () => void
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
  return Boolean((currentEmail || nextEmail) && currentEmail !== nextEmail)
}

function storedSessionMatches(session: Exclude<Session, null>): boolean {
  try {
    const stored = localStorage.getItem('session')
    if (!stored) return false
    const storedSession = JSON.parse(stored) as Session
    return storedSession?.userId === session.userId
  } catch {
    return false
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: (() => {
    try {
      const stored = localStorage.getItem('session')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })(),
  setSession: (session) => {
    const current = get().session
    if ((session && !current) || sessionsHaveDifferentUsers(current, session)) {
      removeUserScopedData()
    }
    if (session) {
      localStorage.setItem('session', JSON.stringify(session))
    } else {
      localStorage.removeItem('session')
      removeUserScopedData()
    }
    set({ session })
  },
  updateName: (name) => {
    const current = get().session
    if (current) {
      if (!storedSessionMatches(current)) return
      const updated = { ...current, name }
      localStorage.setItem('session', JSON.stringify(updated))
      set({ session: updated })
    }
  },
  updateAvatar: (avatar_url) => {
    const current = get().session
    if (current) {
      if (!storedSessionMatches(current)) return
      const updated = { ...current, avatar_url }
      localStorage.setItem('session', JSON.stringify(updated))
      set({ session: updated })
    }
  },
  logout: () => {
    localStorage.removeItem('session')
    removeUserScopedData()
    set({ session: null })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'session' && event.key !== null) return

    const current = useAuthStore.getState().session
    let nextSession: Session = null
    try {
      nextSession = event.newValue ? JSON.parse(event.newValue) : null
    } catch {
      nextSession = null
    }

    if (
      (!current && nextSession) ||
      sessionsHaveDifferentUsers(current, nextSession) ||
      !nextSession
    ) {
      removeUserScopedData()
    }
    useAuthStore.setState({ session: nextSession })
  })
}