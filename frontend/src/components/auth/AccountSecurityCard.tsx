import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { api } from '../../api/client'
import { Lock, CheckCircle2, AlertCircle, Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react'

interface AccountSecurityCardProps {
  userEmail?: string
  role?: string
}

export function AccountSecurityCard({ userEmail, role: _role = 'User' }: AccountSecurityCardProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState('')
  const [updateError, setUpdateError] = useState('')

  const [isSendingReset, setIsSendingReset] = useState(false)
  const [resetSuccess, setResetSuccess] = useState('')
  const [resetError, setResetError] = useState('')

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setUpdateSuccess('')
    setUpdateError('')

    if (!currentPassword) {
      setUpdateError('Current password is required.')
      return
    }
    if (newPassword.length < 8) {
      setUpdateError('New password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setUpdateError('New passwords do not match. Please verify.')
      return
    }
    if (currentPassword === newPassword) {
      setUpdateError('New password must be different from current password.')
      return
    }

    setIsUpdating(true)
    try {
      const res = await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      setUpdateSuccess(res.data?.message || 'Password changed successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setUpdateSuccess(''), 5000)
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Failed to update password. Please check your current password.'
      setUpdateError(detail)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleSendResetEmail = async () => {
    if (!userEmail) {
      setResetError('Unable to detect registered email address.')
      return
    }
    setIsSendingReset(true)
    setResetSuccess('')
    setResetError('')
    try {
      const res = await api.post('/auth/forgot-password', { email: userEmail.trim().toLowerCase() })
      setResetSuccess(res.data?.message || `Password reset link dispatched to ${userEmail}.`)
      setTimeout(() => setResetSuccess(''), 6000)
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Failed to dispatch reset email. Please try again.'
      setResetError(detail)
    } finally {
      setIsSendingReset(false)
    }
  }

  return (
    <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
              Account Security & Password
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
              Manage your credentials, update your password, or request an email reset link.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-6">
        {/* Form 1: Direct Password Change */}
        <form onSubmit={handleChangePassword} className="space-y-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
            Update Password
          </h4>

          {updateSuccess && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{updateSuccess}</span>
            </div>
          )}

          {updateError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{updateError}</span>
            </div>
          )}

          <div className="relative">
            <Input
              label="Current Password"
              type={showCurrent ? 'text' : 'password'}
              placeholder="Enter current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-3 top-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              tabIndex={-1}
            >
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Input
                label="New Password"
                type={showNew ? 'text' : 'password'}
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-8 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div>
              <Input
                label="Confirm New Password"
                type={showNew ? 'text' : 'password'}
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-1">
            <Button type="submit" variant="primary" size="sm" isLoading={isUpdating}>
              Save New Password
            </Button>
          </div>
        </form>

        {/* Section 2: Alternative Email Reset Link */}
        {userEmail && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700/60">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-500" />
                  Forgot or Need Reset Link?
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Send a one-click password reset token directly to <span className="font-semibold text-slate-700 dark:text-slate-300">{userEmail}</span>.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                isLoading={isSendingReset}
                onClick={handleSendResetEmail}
                className="shrink-0"
              >
                Send Reset Link
              </Button>
            </div>

            {resetSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{resetSuccess}</span>
              </div>
            )}

            {resetError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resetError}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
