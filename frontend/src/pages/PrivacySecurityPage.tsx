import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck,
  Lock,
  Download,
  Trash2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Mail,
  KeyRound,
  FileText,
  Smartphone,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

export function PrivacySecurityPage() {
  const { session, logout } = useAuthStore()
  const navigate = useNavigate()

  // State
  const [preferences, setPreferences] = useState({
    analytics_cookies: false,
    marketing_emails: false,
    third_party_sharing_opt_out: true,
    profile_visibility: 'COMMUNITY',
  })
  const [, setLoadingPrefs] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Export State
  const [exporting, setExporting] = useState(false)

  // Deletion Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // 1. Fetch user privacy preferences on load
  useEffect(() => {
    if (!session?.accessToken) return
    setLoadingPrefs(true)
    api
      .get('/privacy/preferences')
      .then((res) => {
        setPreferences({
          analytics_cookies: res.data.analytics_cookies ?? false,
          marketing_emails: res.data.marketing_emails ?? false,
          third_party_sharing_opt_out: res.data.third_party_sharing_opt_out ?? true,
          profile_visibility: res.data.profile_visibility ?? 'COMMUNITY',
        })
      })
      .catch(() => {
        // Fallback to local defaults
      })
      .finally(() => setLoadingPrefs(false))
  }, [session?.accessToken])

  // 2. Save Privacy Preferences
  const handleSavePreferences = async () => {
    setSavingPrefs(true)
    setSaveSuccess(false)
    try {
      await api.put('/privacy/preferences', preferences)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch {
      alert('Failed to save privacy preferences. Please try again.')
    } finally {
      setSavingPrefs(false)
    }
  }

  // 3. One-click CCPA Opt-out
  const handleCcpaOptOut = async () => {
    try {
      await api.post('/privacy/ccpa-opt-out')
      setPreferences((prev) => ({ ...prev, third_party_sharing_opt_out: true }))
      alert('CCPA Do Not Sell/Share request registered successfully.')
    } catch {
      alert('Could not submit opt-out request.')
    }
  }

  // 4. Data Portability Export (GDPR Art. 20 / CCPA)
  const handleExportData = async () => {
    setExporting(true)
    try {
      const response = await api.get('/privacy/export', { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `internsphere_user_data_export_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      alert('Failed to generate your data export archive. Please verify you are logged in.')
    } finally {
      setExporting(false)
    }
  }

  // 5. Account Deletion Execution (GDPR Art. 17)
  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setDeleteError('')

    if (deleteConfirmation.trim().toUpperCase() !== 'DELETE MY ACCOUNT') {
      setDeleteError("Confirmation text must match 'DELETE MY ACCOUNT'.")
      return
    }

    setDeleting(true)
    try {
      await api.post('/privacy/delete-account', {
        password: deletePassword,
        confirmation_phrase: deleteConfirmation,
        reason: deleteReason || undefined,
      })
      alert('Your account and all associated personal records have been permanently erased.')
      logout()
      navigate('/login')
    } catch (err: any) {
      setDeleteError(err.response?.data?.detail || 'Account deletion failed. Check password.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="relative overflow-hidden p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl border border-indigo-900/50">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>GDPR (EU) & CCPA (CA) Compliant</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                <span>AES-256 & Argon2id Encrypted</span>
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Privacy & Data Security Center
            </h1>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Exercise your data rights, export your platform history, enforce privacy opt-outs, and manage your authentication security in accordance with global data protection standards.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/privacy">
              <Button variant="outline" size="sm" className="bg-white/10 hover:bg-white/20 text-white border-white/20">
                <FileText className="w-4 h-4 mr-1.5" />
                Privacy Policy
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20"
              onClick={() => window.dispatchEvent(new Event('open:cookie-preferences'))}
            >
              Cookie Preferences
            </Button>
          </div>
        </div>
      </div>

      {/* Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Security & Authentication Overview */}
        <div className="lg:col-span-1 space-y-6">
          {/* Security Posture Card */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Security Posture</h3>
                <p className="text-xs text-slate-500">Authentication & Encryption</p>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Password Hashing
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">Argon2id</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Data Encryption at Rest
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">AES-256</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Transport Security
                </span>
                <span className="font-semibold text-slate-900 dark:text-white">TLS 1.3 / HSTS</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-500" />
                  Two-Factor Auth (MFA)
                </span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                  {session?.role === 'ADMIN' ? 'Required (Active)' : 'Available'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <Link to="/forgot-password">
                <Button variant="outline" size="sm" className="w-full text-xs">
                  <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                  Change or Reset Password
                </Button>
              </Link>
            </div>
          </Card>

          {/* DPO & Contact Card */}
          <Card className="p-6 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs space-y-3">
            <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-indigo-500" />
              <span>Data Protection Officer (DPO)</span>
            </h4>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
              Have specific privacy requests or questions about automated processing? Contact our designated compliance team:
            </p>
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-indigo-600 dark:text-indigo-400 font-semibold text-center select-all">
              privacy@internsphere.com
            </div>
          </Card>
        </div>

        {/* Right Columns: Data Rights & Preferences */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card: GDPR Art. 15 & 20 / CCPA Data Portability */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Data Portability & Export
                  </h3>
                  <Badge status="STUDENT" className="text-[10px] uppercase font-bold">
                    GDPR Art. 20
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Download a complete, machine-readable JSON archive containing all your profile data, submitted applications, resumes, reviews, conversations, and security logs.
                </p>
              </div>

              <Button
                variant="primary"
                size="sm"
                onClick={handleExportData}
                isLoading={exporting}
                leftIcon={<Download className="w-4 h-4" />}
                className="shrink-0"
              >
                Export My Data
              </Button>
            </div>
          </Card>

          {/* Card: Consent & Privacy Preferences Management */}
          <Card className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-500" />
                  <span>Consent & Privacy Preferences</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure how your data is used for telemetry, communication, and sharing
                </p>
              </div>

              {saveSuccess && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>

            <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              {/* Analytics Toggle */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Performance & Analytics Tracking
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Collects aggregated metrics on page rendering and interface latency to diagnose platform issues. No third-party ad tracking.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={preferences.analytics_cookies}
                    onChange={(e) =>
                      setPreferences((prev) => ({ ...prev, analytics_cookies: e.target.checked }))
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {/* Marketing Toggle */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Career Opportunity & Recommendation Emails
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Receive verified role announcements and campus recruiting event alerts matching your skills and major.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={preferences.marketing_emails}
                    onChange={(e) =>
                      setPreferences((prev) => ({ ...prev, marketing_emails: e.target.checked }))
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {/* CCPA Do Not Sell Toggle */}
              <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Do Not Sell or Share My Information (CCPA)
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                      California
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    InternSphere never sells candidate data. Enabling this enforces strict restriction on any external analytics or cross-context disclosure.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={preferences.third_party_sharing_opt_out}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        third_party_sharing_opt_out: e.target.checked,
                      }))
                    }
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleCcpaOptOut}
                className="text-xs text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 underline"
              >
                Trigger Immediate CCPA Opt-Out
              </button>

              <Button
                variant="primary"
                size="sm"
                onClick={handleSavePreferences}
                isLoading={savingPrefs}
              >
                Save Preferences
              </Button>
            </div>
          </Card>

          {/* Danger Zone: GDPR Art. 17 Right to Erasure */}
          <Card className="p-6 bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/60 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <h3 className="text-base font-bold text-rose-900 dark:text-rose-200">
                    Right to Erasure ('Right to be Forgotten')
                  </h3>
                  <Badge status="REJECTED" className="text-[10px] uppercase font-bold">
                    GDPR Art. 17
                  </Badge>
                </div>
                <p className="text-xs text-rose-700/80 dark:text-rose-300/80 leading-relaxed">
                  Permanently delete your account, stored resumes, applications, messages, and identity records. This action is irreversible.
                </p>
              </div>

              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteModalOpen(true)}
                className="shrink-0"
              >
                Delete Account
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Account Deletion Confirmation Modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-900 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/80 text-rose-600">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Permanently Erase Account?
                </h3>
                <p className="text-xs text-slate-500">GDPR & CCPA Irreversible Deletion</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              All personal data, uploaded resumes, and active applications will be wiped from our databases immediately.
            </p>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium">
                {deleteError}
              </div>
            )}

            <form onSubmit={handleDeleteAccount} className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Enter Password to Verify Identity:
                </label>
                <input
                  type="password"
                  required
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Type <span className="font-mono text-rose-600 font-bold">DELETE MY ACCOUNT</span>:
                </label>
                <input
                  type="text"
                  required
                  placeholder="DELETE MY ACCOUNT"
                  value={deleteConfirmation}
                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  isLoading={deleting}
                  disabled={deleteConfirmation.trim().toUpperCase() !== 'DELETE MY ACCOUNT'}
                >
                  Confirm Permanent Erasure
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
