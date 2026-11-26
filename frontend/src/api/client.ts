import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore, type Session } from '../store/auth'

const getBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim()
  if (import.meta.env.PROD && !configuredUrl) {
    throw new Error('VITE_API_URL is required for production builds.')
  }
  return (configuredUrl || 'http://localhost:8010/api/v1').replace(/\/+$/, '')
}

export const getFullMediaUrl = (path?: string | null): string | null => {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const apiBase = new URL(getBaseUrl(), window.location.origin)
  const basePath = apiBase.pathname.replace(/\/api\/v1\/?$/, '')
  const mediaPath = `${basePath}/${path.replace(/^\/+/, '')}`
  return new URL(mediaPath, apiBase.origin).toString()
}

export const getWebSocketBaseUrl = (): string => {
  const configuredUrl = import.meta.env.VITE_WS_URL?.trim()
  const url = new URL(configuredUrl || getBaseUrl(), window.location.origin)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

export const api = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Accept': 'application/json',
  },
})

type RetriableRequest = InternalAxiosRequestConfig & {
  _retry?: boolean
  _rateLimitRetried?: boolean
  _connectionRetryCount?: number
}

const MAX_CONNECTION_RETRIES = 2

function retryDelaySeconds(retryAfter: unknown): number {
  if (typeof retryAfter !== 'string') return 1
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds))
  const dateDelay = Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
  return Number.isFinite(dateDelay) ? Math.max(1, dateDelay) : 1
}

function isAuthenticationFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false
  if (error.response?.status === 401) return true
  if (error.response?.status !== 403) return false
  const detail = error.response.data?.detail
  const message = typeof detail === 'string' ? detail.toLowerCase() : ''
  return (
    (message.includes('token') && /invalid|expired|unauthorized/.test(message))
    || /not authenticated|validate credentials/.test(message)
  )
}

function isTransientFailure(error: unknown): boolean {
  return axios.isAxiosError(error)
    && error.code !== 'ERR_CANCELED'
    && (!error.response || error.response.status >= 500)
}

function notifyConnectionProblem(retrying: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: {
      kind: 'warning',
      message: retrying
        ? 'Connection problem, retrying...'
        : 'Connection problem. Your session is still active; try again.',
    },
  }))
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

api.interceptors.request.use((config) => {
  const session = useAuthStore.getState().session
  if (session?.accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return config
})

let refreshPromise: Promise<NonNullable<Session>> | null = null

function readPersistentSession(): Session {
  try {
    return JSON.parse(localStorage.getItem('session') || 'null') as Session
  } catch {
    return null
  }
}

function expireSession(userId?: number): void {
  const currentSession = useAuthStore.getState().session
  if (userId !== undefined && currentSession?.userId !== userId) return
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem('session_expired_message', 'true')
  }
  useAuthStore.getState().logout(false)
}

async function refreshSessionRequest(): Promise<NonNullable<Session>> {
  const snapshot = useAuthStore.getState().session
  if (!snapshot?.refreshToken) throw new Error('No refresh token is available.')
  const refreshUserId = snapshot.userId

  const refresh = async (): Promise<NonNullable<Session>> => {
    const state = useAuthStore.getState()
    const currentSession = state.persistence === 'local'
      ? readPersistentSession() ?? state.session
      : state.session
    if (!currentSession || currentSession.userId !== refreshUserId) {
      throw new Error('Session changed while refreshing the access token.')
    }
    if (currentSession.accessToken !== snapshot.accessToken) {
      useAuthStore.getState().setSession(currentSession, state.persistence)
      return currentSession
    }

    let response
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          { refresh_token: currentSession.refreshToken },
        )
        break
      } catch (error) {
        if (!isTransientFailure(error) || attempt >= MAX_CONNECTION_RETRIES) {
          if (isTransientFailure(error)) notifyConnectionProblem(false)
          throw error
        }
        notifyConnectionProblem(true)
        await wait(500 * (2 ** attempt) + Math.random() * 250)
      }
    }
    const tokens = response.data
    const updatedSession = {
      ...currentSession,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      role: tokens.role,
      userId: tokens.user_id ?? currentSession.userId,
      accessTokenExpiresAt: tokens.access_token_expires_at ?? null,
      refreshTokenExpiresAt: tokens.refresh_token_expires_at ?? null,
      accessTokenExpiresIn: tokens.access_token_expires_in ?? null,
      refreshTokenExpiresIn: tokens.refresh_token_expires_in ?? null,
    }
    useAuthStore.getState().setSession(updatedSession, state.persistence)
    return updatedSession
  }

  try {
    const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
    return useAuthStore.getState().persistence === 'local' && lockManager
      ? await lockManager.request('internship-auth-refresh', refresh)
      : await refresh()
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      expireSession(refreshUserId)
    }
    throw error
  }
}

export async function refreshSession(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshSessionRequest().finally(() => {
      refreshPromise = null
    })
  }
  return (await refreshPromise).accessToken
}

export function getAccessTokenExpirationMs(session: Session): number | null {
  if (!session) return null
  try {
    const payload = session.accessToken.split('.')[1]
    if (payload) {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { exp?: unknown }
      if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) return decoded.exp * 1000
    }
  } catch {
    // Use the server-provided expiry metadata for non-JWT test or legacy tokens.
  }
  if (session.accessTokenExpiresAt) {
    const expiresAt = Date.parse(session.accessTokenExpiresAt)
    if (Number.isFinite(expiresAt)) return expiresAt
  }
  return null
}

function isTokenIssuanceEndpoint(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0]
  return /\/auth\/(login|refresh|google|mfa\/verify-login)(?:$|\/)/.test(path)
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetriableRequest | undefined

    if (error.response?.status === 429 && originalRequest) {
      const delaySeconds = retryDelaySeconds(error.response.headers?.['retry-after'])
      const detail = error.response.data?.detail
      const method = String(originalRequest.method || 'get').toLowerCase()
      const retryAutomatically = method === 'get' || method === 'head'
      const message = typeof detail === 'string'
        ? detail
        : `Too many requests. Please wait ${delaySeconds} seconds and try again.`
      error.message = message
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:rate-limit', {
          detail: {
            message: retryAutomatically
              ? `Request rate-limited. Retrying in ${delaySeconds} seconds.`
              : message,
            retryAfterSeconds: delaySeconds,
          },
        }))
      }
      if (!originalRequest._rateLimitRetried && retryAutomatically) {
        originalRequest._rateLimitRetried = true
        await new Promise((resolve) => window.setTimeout(resolve, delaySeconds * 1000))
        return api(originalRequest)
      }
      return Promise.reject(error)
    }

    if (
      isAuthenticationFailure(error)
      && originalRequest
      && !originalRequest._retry
      && !isTokenIssuanceEndpoint(originalRequest.url)
    ) {
      const session = useAuthStore.getState().session
      if (!session?.refreshToken) {
        expireSession(session?.userId)
        return Promise.reject(error)
      }
      originalRequest._retry = true
      try {
        const accessToken = await refreshSession()
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    if (isTransientFailure(error)) {
      const method = String(originalRequest?.method || 'get').toLowerCase()
      const retryCount = originalRequest?._connectionRetryCount ?? 0
      const canRetry = (method === 'get' || method === 'head')
        && retryCount < MAX_CONNECTION_RETRIES
      notifyConnectionProblem(canRetry)
      if (canRetry && originalRequest) {
        originalRequest._connectionRetryCount = retryCount + 1
        await wait(500 * (2 ** retryCount) + Math.random() * 250)
        return api(originalRequest)
      }
    }

    return Promise.reject(error)
  },
)

/**
 * Authenticated file download helper.
 * Fetches the resource with Authorization header and triggers browser file download.
 */
export async function downloadAuthenticatedFile(url: string, defaultFilename: string = 'download'): Promise<string> {
  const response = await api.get(url, { responseType: 'blob' })
  const contentDisposition = response.headers['content-disposition']
  let filename = defaultFilename
  if (contentDisposition) {
    const match = contentDisposition.match(/filename="?([^"]+)"?/)
    if (match && match[1]) filename = match[1]
  }

  const contentType = response.headers['content-type']
  const blob = new Blob([response.data], { type: contentType ? String(contentType) : undefined })
  const blobUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(blobUrl)
  return filename
}

export async function openAuthenticatedFile(url: string, defaultFilename: string = 'document') {
  const apiOrigin = new URL(api.defaults.baseURL || window.location.origin, window.location.origin).origin
  const resourceOrigin = new URL(url, api.defaults.baseURL || window.location.origin).origin
  if (resourceOrigin !== apiOrigin) {
    throw new Error('Authenticated file URLs must be hosted by the configured API.')
  }
  const response = await api.get(url, { responseType: 'blob' })
  const contentType = response.headers['content-type']
  const blob = new Blob([response.data], { type: contentType ? String(contentType) : undefined })
  const blobUrl = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.download = defaultFilename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000)
}
