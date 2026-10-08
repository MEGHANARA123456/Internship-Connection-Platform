import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Cookie, Settings, Check, X, Lock } from 'lucide-react'
import { Button } from './Button'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import {
  COOKIE_CONSENT_KEY,
  deleteCookie,
  getCookieConsent,
  setCookie,
  THEME_COOKIE_KEY,
} from '../../lib/cookies'

export interface CookiePreferences {
  necessary: boolean // always true
  functional: boolean
  analytics: boolean
  marketing: boolean
  doNotSell: boolean // CCPA
  consentedAt: string
}

const STORAGE_KEY = COOKIE_CONSENT_KEY

export function CookieConsentBanner() {
  const { session } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [functional, setFunctional] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [doNotSell, setDoNotSell] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      const cookieConsent = getCookieConsent()
      if (cookieConsent) {
        setFunctional(cookieConsent.functional)
        setAnalytics(cookieConsent.analytics)
        return
      }

      // Delay slightly for smooth entrance
      const timer = setTimeout(() => setIsOpen(true), 800)
      return () => clearTimeout(timer)
    } else {
      try {
        const parsed = JSON.parse(saved) as CookiePreferences
        const cookieConsent = getCookieConsent()
        setFunctional(cookieConsent?.functional ?? parsed.functional ?? false)
        setAnalytics(cookieConsent?.analytics ?? parsed.analytics)
        setMarketing(parsed.marketing)
        setDoNotSell(parsed.doNotSell ?? true)
      } catch {
        setIsOpen(true)
      }
    }
  }, [])

  // Listen to custom event to re-open modal from footer or privacy page
  useEffect(() => {
    const handleReopen = () => {
      setModalOpen(true)
    }
    window.addEventListener('open:cookie-preferences', handleReopen)
    return () => window.removeEventListener('open:cookie-preferences', handleReopen)
  }, [])

  const savePreferences = async (prefs: CookiePreferences) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    setFunctional(prefs.functional)
    setAnalytics(prefs.analytics)
    setMarketing(prefs.marketing)
    setDoNotSell(prefs.doNotSell)
    const cookieConsent = {
      necessary: true,
      functional: prefs.functional,
      analytics: prefs.analytics,
      consentedAt: prefs.consentedAt,
    }
    setCookie(STORAGE_KEY, JSON.stringify(cookieConsent), 365)

    const savedTheme = localStorage.getItem('theme')
    if (prefs.functional && (savedTheme === 'light' || savedTheme === 'dark')) {
      setCookie(THEME_COOKIE_KEY, savedTheme, 365)
    } else {
      deleteCookie(THEME_COOKIE_KEY)
    }

    setIsOpen(false)
    setModalOpen(false)

    // If authenticated, sync with backend privacy preferences
    if (session?.accessToken) {
      try {
        await api.put('/privacy/preferences', {
          analytics_cookies: prefs.analytics,
          marketing_emails: prefs.marketing,
          third_party_sharing_opt_out: prefs.doNotSell,
          profile_visibility: 'COMMUNITY',
        })
      } catch {
        // Silently continue; local consent is saved
      }
    }
  }

  const handleAcceptAll = () => {
    savePreferences({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
      doNotSell: false,
      consentedAt: new Date().toISOString(),
    })
  }

  const handleDeclineOptional = () => {
    savePreferences({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
      doNotSell: true,
      consentedAt: new Date().toISOString(),
    })
  }

  const handleSaveCustom = () => {
    savePreferences({
      necessary: true,
      functional,
      analytics,
      marketing,
      doNotSell,
      consentedAt: new Date().toISOString(),
    })
  }

  return (
    <>
      {/* Floating Bottom Consent Banner */}
      {isOpen && !modalOpen && (
        <aside
          role="region"
          aria-label="Privacy and Cookie Consent"
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-xl z-50 animate-in fade-in slide-in-from-bottom-5 duration-300"
        >
          <div className="p-4 sm:p-5 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex flex-col gap-3.5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
                <Cookie className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Privacy & Cookie Choices
                  </h3>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                    GDPR & CCPA
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  We use cookies and encrypted local storage to secure your sessions, ensure role verification, and improve platform performance. You can customize your preferences anytime.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <Link
                to="/privacy"
                className="text-[11px] font-medium text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 underline underline-offset-2"
              >
                Review Privacy Policy &rarr;
              </Link>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setModalOpen(true)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Settings className="w-3 h-3" />
                  <span>Customize</span>
                </button>
                <button
                  onClick={handleDeclineOptional}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                >
                  Essential Only
                </button>
                <button
                  onClick={handleAcceptAll}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all cursor-pointer"
                >
                  Accept All
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Detailed Granular Preferences Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Privacy & Consent Center
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Manage granular data processing per GDPR & CCPA
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Categories */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* Category 1: Strictly Necessary */}
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Strictly Necessary (Required)
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                      Always Active
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Essential for secure authentication, Argon2 session validation, CSRF defenses, and role verification. Cannot be disabled.
                  </p>
                </div>
                <div className="p-1 bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 rounded-md shrink-0">
                  <Check className="w-4 h-4" />
                </div>
              </div>

              {/* Category 2: Performance & Analytics */}
              <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Functional Preferences
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Remembers your display preferences, including your light or dark theme.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    aria-label="Functional Preferences"
                    checked={functional}
                    onChange={(e) => setFunctional(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {/* Category 3: Performance & Analytics */}
              <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Performance & Analytics
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Helps us aggregate page load metrics, system uptime, and feature adoption anonymously to improve platform responsiveness.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={analytics}
                    onChange={(e) => setAnalytics(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {/* Category 4: Communications & Marketing */}
              <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Marketing & Opportunity Notifications
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Delivers curated internship updates, new verified employer invitations, and platform enhancements to your verified email.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={marketing}
                    onChange={(e) => setMarketing(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {/* Category 5: CCPA Opt-Out */}
              <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Do Not Sell or Share My Information (CCPA)
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                      California
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    InternSphere never sells personal data. When enabled, this enforces strict cross-context data sharing opt-out per Cal. Civ. Code § 1798.120.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={doNotSell}
                    onChange={(e) => setDoNotSell(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <Link
                to="/privacy"
                onClick={() => setModalOpen(false)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Full Privacy Policy
              </Link>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFunctional(false)
                    setAnalytics(false)
                    setMarketing(false)
                    setDoNotSell(true)
                  }}
                >
                  Reset Defaults
                </Button>
                <Button variant="primary" size="sm" onClick={handleSaveCustom}>
                  Save Preferences
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
