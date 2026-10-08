import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore, USER_SCOPED_KEYS, type Session } from './auth'

const firstUser: NonNullable<Session> = {
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  role: 'STUDENT',
  userId: 1,
  email: 'first@example.com',
}

const secondUser: NonNullable<Session> = {
  accessToken: 'access-b',
  refreshToken: 'refresh-b',
  role: 'STUDENT',
  userId: 2,
  email: 'second@example.com',
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ session: null })
})

describe('user-scoped authentication storage', () => {
  it('clears the session and all user-scoped keys on logout', () => {
    useAuthStore.getState().setSession(firstUser)
    USER_SCOPED_KEYS.forEach((key) => localStorage.setItem(key, 'user data'))

    useAuthStore.getState().logout()

    expect(localStorage.getItem('session')).toBeNull()
    USER_SCOPED_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull())
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('clears user-scoped keys when switching users', () => {
    useAuthStore.getState().setSession(firstUser)
    USER_SCOPED_KEYS.forEach((key) => localStorage.setItem(key, 'user data'))

    useAuthStore.getState().setSession(secondUser)

    USER_SCOPED_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull())
    expect(JSON.parse(localStorage.getItem('session') || 'null').userId).toBe(2)
  })

  it('updates the in-memory session from a session storage event', () => {
    useAuthStore.getState().setSession(firstUser)
    localStorage.setItem('session', JSON.stringify(secondUser))

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'session',
        newValue: JSON.stringify(secondUser),
        storageArea: localStorage,
      })
    )

    expect(useAuthStore.getState().session).toEqual(secondUser)
  })
})
