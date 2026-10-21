import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore, type Session } from '../store/auth'

const getBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8010/api/v1`
  }
  const raw = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8010/api/v1'
  return raw.replace(':8000', ':8010')
}

export const getFullMediaUrl = (path?: string | null): string | null => {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = getBaseUrl().replace('/api/v1', '')
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
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
}

function retryDelaySeconds(retryAfter: unknown): number {
  if (typeof retryAfter !== 'string') return 1
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds))
  const dateDelay = Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
  return Number.isFinite(dateDelay) ? Math.max(1, dateDelay) : 1
}

api.interceptors.request.use((config) => {
  const session = useAuthStore.getState().session
  if (session?.accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return config
})

let isRefreshing = false
let failedQueue: Array<{
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error)
    else prom.resolve(token)
  })
  failedQueue = []
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

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const session = useAuthStore.getState().session
      if (!session?.refreshToken) {
        useAuthStore.getState().logout()
        return Promise.reject(error)
      }
      const refreshUserId = session.userId

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api(originalRequest)
          })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const refresh = async () => {
          let persistentSession: Session = null
          if (useAuthStore.getState().persistence === 'local') {
            try {
              persistentSession = JSON.parse(localStorage.getItem('session') || 'null') as Session
            } catch {
              persistentSession = null
            }
          }
          const currentSession = persistentSession ?? useAuthStore.getState().session
          if (!currentSession || currentSession.userId !== refreshUserId) {
            throw new Error('Session changed while refreshing the access token.')
          }
          if (currentSession.accessToken !== session.accessToken) return currentSession

          const response = await axios.post(
            `${api.defaults.baseURL}/auth/refresh`,
            { refresh_token: currentSession.refreshToken },
          )
          const tokens = response.data
          const updatedSession = {
            ...currentSession,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            role: tokens.role,
            accessTokenExpiresAt: tokens.access_token_expires_at ?? null,
            refreshTokenExpiresAt: tokens.refresh_token_expires_at ?? null,
            accessTokenExpiresIn: tokens.access_token_expires_in ?? null,
            refreshTokenExpiresIn: tokens.refresh_token_expires_in ?? null,
          }
          useAuthStore.getState().setSession(updatedSession)
          return updatedSession
        }

        const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
        const updatedSession = useAuthStore.getState().persistence === 'local' && lockManager
          ? await lockManager.request('internship-auth-refresh', refresh)
          : await refresh()
        processQueue(null, updatedSession.accessToken)
        originalRequest.headers.Authorization = `Bearer ${updatedSession.accessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        if (useAuthStore.getState().session?.userId === refreshUserId) {
          useAuthStore.getState().logout()
        }
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)

/**
 * Authenticated file download helper.
 * Fetches the resource with Authorization header and triggers browser file download.
 */
export async function downloadAuthenticatedFile(url: string, defaultFilename: string = 'download') {
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
