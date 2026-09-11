import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AlertCircle } from 'lucide-react'

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: any) => void
          prompt: (notification?: any) => void
          renderButton: (element: HTMLElement, options: any) => void
        }
      }
    }
  }
}

interface GoogleSignInButtonProps {
  role?: 'STUDENT' | 'COMPANY' | 'ADMIN'
  buttonText?: string
  className?: string
  onError?: (msg: string) => void
}

export function GoogleSignInButton({
  role = 'STUDENT',
  buttonText = 'Continue with Google',
  className = '',
  onError,
}: GoogleSignInButtonProps) {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleAuthSuccess = (data: {
    access_token: string
    refresh_token: string
    role: string
    user_id: number
    name?: string
    email?: string
    avatar_url?: string | null
  }, userEmail: string) => {
    const finalEmail = data.email || userEmail
    setSession({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      role: (data.role as any) || role,
      userId: data.user_id,
      email: finalEmail,
      name: data.name || undefined,
      avatar_url: data.avatar_url,
    })

    if (data.role === 'ADMIN') {
      navigate('/admin')
    } else if (data.role === 'COMPANY') {
      navigate('/company/jobs')
    } else {
      navigate('/opportunities')
    }
  }

  // Initialize Google Identity Services when its async script becomes available.
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    let attempts = 0
    const initialize = () => {
      if (!clientId || !window.google?.accounts?.id) return
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (response: { credential?: string }) => {
            if (!response.credential) return
            setLoading(true)
            try {
              const res = await api.post('/auth/google', {
                credential: response.credential,
                role,
              })
              handleAuthSuccess(res.data, res.data.email || 'google-user@gmail.com')
            } catch (err: any) {
              const detail = err.response?.data?.detail || 'Google sign-in verification failed.'
              setErrorMsg(detail)
              onError?.(detail)
            } finally {
              setLoading(false)
            }
          },
        })
      } catch (err) {
        console.warn('GIS init warning', err)
      }
    }
    initialize()
    const timer = window.setInterval(() => {
      attempts += 1
      initialize()
      if (window.google?.accounts?.id || attempts >= 20) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [role])

  const handleClick = () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    // Use the real Google OAuth popup. Never accept a typed email as identity proof.
    if (clientId && (window as any).google?.accounts?.oauth2) {
      try {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'email profile openid',
          callback: async (tokenResponse: any) => {
            if (tokenResponse.error || !tokenResponse.access_token) {
              setModalOpen(true)
              return
            }
            setLoading(true)
            try {
              const res = await api.post('/auth/google', {
                credential: tokenResponse.access_token,
                role,
              })
              handleAuthSuccess(res.data, res.data.email || 'google-user@gmail.com')
            } catch (err: any) {
              const detail = err.response?.data?.detail || 'Google sign-in verification failed.'
              setErrorMsg(detail)
              setModalOpen(true)
            } finally {
              setLoading(false)
            }
          },
        })
        client.requestAccessToken()
        return
      } catch (err) {
        console.warn('Google OAuth2 popup initialization failed, opening SSO selector', err)
      }
    }
    setErrorMsg(
      clientId
        ? 'Google services are still loading. Please try again in a moment.'
        : 'Google SSO is not configured. Set VITE_GOOGLE_CLIENT_ID and restart the frontend.'
    )
    setModalOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={`w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/70 font-semibold text-xs flex items-center justify-center gap-2.5 transition-all shadow-2xs hover:shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>{loading ? 'Authenticating with Google...' : buttonText}</span>
      </button>

      {/* Interactive Google SSO Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Sign in with Google"
        description="Authenticate directly using your Google account."
      >
        <div className="space-y-4 pt-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <p className="text-sm text-slate-600 dark:text-slate-300">
            {errorMsg || 'Use the Google account popup to authenticate securely.'}
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={() => setModalOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </>
  )
}
