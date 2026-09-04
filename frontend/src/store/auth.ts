import { create } from 'zustand'

export type UserRole = 'STUDENT' | 'COMPANY' | 'ADMIN'

export type Session = {
  accessToken: string
  refreshToken: string
  role: UserRole
  userId?: number
  email?: string
} | null

type AuthState = {
  session: Session
  setSession: (session: Session) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
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
  logout: () => {
    localStorage.removeItem('session')
    set({ session: null })
  },
}))