import axios from 'axios'
import { useAuthStore } from '../store/auth'

const getBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8010/api/v1`
  }
  const raw = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8010/api/v1'
  return raw.replace(':8000', ':8010')
}

export const api = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    'Accept': 'application/json',
  },
})

// Request interceptor: attach token
api.interceptors.request.use((config) => {
  const session = useAuthStore.getState().session
  if (session?.accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return config
})

// Response interceptor: auto-refresh on 401
let isRefreshing = false
let failedQueue: Array<{
  resolve: (value?: unknown) => void
  reject: (reason?: unknown) => void
}> = []

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token)
    }
  })
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      const session = useAuthStore.getState().session
      if (!session?.refreshToken) {
        useAuthStore.getState().logout()
        return Promise.reject(error)
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`
            return api(originalRequest)
          })
          .catch((err) => Promise.reject(err))
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const res = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          { refresh_token: session.refreshToken }
        )
        const newTokens = res.data
        useAuthStore.getState().setSession({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          role: newTokens.role,
          userId: newTokens.user_id,
        })
        processQueue(null, newTokens.access_token)
        originalRequest.headers.Authorization = `Bearer ${newTokens.access_token}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        useAuthStore.getState().logout()
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
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