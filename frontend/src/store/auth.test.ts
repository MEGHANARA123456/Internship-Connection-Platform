import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore, USER_SCOPED_KEYS, type Session } from './auth'

const student: NonNullable<Session> = {
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  role: 'STUDENT',
  userId: 1,
  email: 'student@example.com',
}

const company: NonNullable<Session> = {
  accessToken: 'access-b',
  refreshToken: 'refresh-b',
  role: 'COMPANY',
  userId: 2,
  email: 'company@example.com',
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useAuthStore.setState({
    session: null,
    persistence: 'session',
    sessionChangedInAnotherTab: false,
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('tab-scoped authentication storage', () => {
  it('clears legacy endorsement data once when the auth store starts', async () => {
    localStorage.setItem('student_recommendations', '[]')
    vi.resetModules()

    await import('./auth')

    expect(localStorage.getItem('student_recommendations')).toBeNull()
  })

  it('stores the default session in sessionStorage, keeping student and company tabs independent', () => {
    useAuthStore.getState().setSession(student, 'session')

    expect(JSON.parse(sessionStorage.getItem('session') || 'null')).toEqual(student)
    expect(localStorage.getItem('session')).toBeNull()

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'session',
      newValue: JSON.stringify(company),
      storageArea: localStorage,
    }))

    expect(useAuthStore.getState().session).toEqual(student)
  })

  it('uses localStorage only when keep-signed-in mode is selected', () => {
    useAuthStore.getState().setSession(company, 'local')

    expect(JSON.parse(localStorage.getItem('session') || 'null')).toEqual(company)
    expect(sessionStorage.getItem('session')).toBeNull()
  })

  it('announces a different persistent identity received from another tab', () => {
    vi.useFakeTimers()
    useAuthStore.getState().setSession(student, 'local')

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'session',
      newValue: JSON.stringify(company),
      storageArea: localStorage,
    }))

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().sessionChangedInAnotherTab).toBe(true)
    expect(sessionStorage.getItem('session_changed_notice')).toBe('true')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('clears the active session and user-scoped data on logout', () => {
    useAuthStore.getState().setSession(student, 'session')
    USER_SCOPED_KEYS.forEach((key) => localStorage.setItem(key, 'user data'))

    useAuthStore.getState().logout()

    expect(sessionStorage.getItem('session')).toBeNull()
    USER_SCOPED_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull())
    expect(useAuthStore.getState().session).toBeNull()
  })
})
