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
} | null

type AuthState = {
  session: Session
  setSession: (session: Session) => void
  updateName: (name: string) => void
  updateAvatar: (avatar_url: string | null) => void
  logout: () => void
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
    if (session) {
      localStorage.setItem('session', JSON.stringify(session))
    } else {
      localStorage.removeItem('session')
    }
    set({ session })
  },
  updateName: (name) => {
    const current = get().session
    if (current) {
      const updated = { ...current, name }
      localStorage.setItem('session', JSON.stringify(updated))
      set({ session: updated })
    }
  },
  updateAvatar: (avatar_url) => {
    const current = get().session
    if (current) {
      const updated = { ...current, avatar_url }
      localStorage.setItem('session', JSON.stringify(updated))
      set({ session: updated })
    }
  },
  logout: () => {
    localStorage.removeItem('session')
    set({ session: null })
  },
}))