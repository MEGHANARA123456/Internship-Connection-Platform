import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Ban, RotateCcw } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { routes } from '../../lib/routes'
import { showToast } from '../../lib/feedback'
import type { AdminStudentDetail } from './types'

export function AdminStudentDetailPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not-found' | 'load' | null>(null)
  const [action, setAction] = useState<'suspend' | 'reactivate' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<AdminStudentDetail>(`/admin/students/${userId}`)
      setDetail(response.data)
    } catch (requestError) {
      const status = (requestError as { response?: { status?: number } }).response?.status
      setError(status === 404 ? 'not-found' : 'load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [userId])

  const submitAction = async () => {
    if (!userId || !action || !reason.trim()) return
    setBusy(true)
    try {
      await api.post(`/admin/users/${userId}/${action}`, { reason: reason.trim() })
      setAction(null)
      setReason('')
      await load()
      showToast(action === 'suspend' ? 'Student suspended.' : 'Student reactivated.', 'success')
    } catch {
      showToast('Could not update this account. Retry the action.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8"><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</main>
  if (error === 'not-found') return <main className="mx-auto max-w-3xl px-4 py-12"><Card className="p-8 text-center dark:bg-slate-900"><h1 className="text-xl font-bold">Student not found</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This account may not exist or is not a student account.</p><Button className="mt-5" variant="outline" onClick={() => navigate(routes.adminStudents())}><ArrowLeft className="mr-2 h-4 w-4" />Back to students</Button></Card></main>
  if (error || !detail) return <main className="mx-auto max-w-3xl px-4 py-12"><div role="alert" className="glass-static rounded-2xl border border-rose-200 bg-white p-8 text-center dark:border-rose-900 dark:bg-slate-900"><p className="font-semibold">Student details could not be loaded.</p><Button className="mt-4" variant="outline" onClick={() => void load()}>Retry</Button></div></main>

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <Link to={routes.adminStudents()} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"><ArrowLeft className="h-4 w-4" />Students</Link>
      <header className="glass-static flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div><p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Student profile · #{detail.account.user_id}</p><h1 className="mt-1 text-2xl font-bold">{detail.profile?.full_name || detail.account.email}</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{detail.account.email}</p></div>
        <div className="flex gap-2">{detail.account.suspended_at ? <Button variant="primary" onClick={() => setAction('reactivate')}><RotateCcw className="mr-2 h-4 w-4" />Reactivate</Button> : <Button variant="outline" className="text-rose-700 dark:text-rose-300" onClick={() => setAction('suspend')}><Ban className="mr-2 h-4 w-4" />Suspend</Button>}</div>
      </header>
      <div role="note" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />Contains personal data. Views are logged.</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Profile</h2>{detail.profile ? <div className="mt-3 space-y-2 text-sm"><p><span className="font-semibold">University:</span> {detail.profile.university}</p><p><span className="font-semibold">Major:</span> {detail.profile.major}</p><p><span className="font-semibold">Graduation year:</span> {detail.profile.graduation_year}</p><p><span className="font-semibold">Skills:</span> <span className="break-words">{detail.profile.skills || 'Not provided'}</span></p><p><span className="font-semibold">Bio:</span> <span className="break-words">{detail.profile.bio || 'Not provided'}</span></p></div> : <p className="mt-3 text-sm text-slate-500">No student profile has been created.</p>}</Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Account</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><dt>Verified</dt><dd>{detail.account.is_verified ? 'Yes' : 'No'}</dd><dt>Account active</dt><dd>{detail.account.is_active ? 'Yes' : 'No'}</dd><dt>MFA enabled</dt><dd>{detail.account.mfa_enabled ? 'Yes' : 'No'}</dd><dt>Created</dt><dd>{new Date(detail.account.created_at).toLocaleDateString()}</dd><dt>Suspended</dt><dd>{detail.account.suspended_at ? new Date(detail.account.suspended_at).toLocaleDateString() : 'No'}</dd></dl></Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Applications <span className="text-sm font-normal text-slate-500">({detail.applications_total} total)</span></h2>{detail.applications.length ? <ul className="mt-3 space-y-2">{detail.applications.map((application) => <li key={application.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><p className="font-semibold">{application.internship_title}</p><p className="text-xs text-slate-500">{application.company_name} · {application.status} · {new Date(application.created_at).toLocaleDateString()}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No applications.</p>}</Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Interviews</h2>{detail.interviews.length ? <ul className="mt-3 space-y-2">{detail.interviews.map((interview, index) => <li key={`${interview.date}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><p className="font-semibold">{interview.internship_title}</p><p className="text-xs text-slate-500">{interview.company_name} · {interview.status} · {new Date(interview.date).toLocaleString()}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No interviews.</p>}</Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Skill assessment attempts</h2>{detail.assessment_attempts.length ? <ul className="mt-3 space-y-2">{detail.assessment_attempts.map((attempt, index) => <li key={`${attempt.topic}-${attempt.submitted_at}-${index}`} className="flex justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><span>{attempt.topic} · {attempt.passed ? 'Passed' : 'Not passed'}</span><span>{attempt.score ?? '—'}% · {new Date(attempt.submitted_at).toLocaleDateString()}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No submitted assessments.</p>}</Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Badges</h2>{detail.badges.length ? <ul className="mt-3 space-y-2">{detail.badges.map((badge, index) => <li key={`${badge.topic}-${badge.issued_at}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><p className="font-semibold">{badge.title} · {badge.score}%</p><p className="text-xs text-slate-500">{badge.valid ? 'Valid' : 'Expired'} · expires {new Date(badge.expires_at).toLocaleDateString()}</p></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No badges earned.</p>}</Card>
      </div>
      <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Recent audit events</h2>{detail.recent_audit_events.length ? <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">{detail.recent_audit_events.map((event) => <li key={event.id} className="py-2 text-sm"><span className="font-semibold">{event.action}</span><span className="ml-2 text-slate-500">{new Date(event.created_at).toLocaleString()}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No recent events.</p>}</Card>
      {action && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="student-action-title" className="glass-strong w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"><h2 id="student-action-title" className="text-lg font-bold">{action === 'suspend' ? 'Suspend student' : 'Reactivate student'}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Enter a reason for this account action.</p><label htmlFor="student-action-reason" className="mt-4 block text-sm font-semibold">Reason</label><textarea id="student-action-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className="glass-input mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" /><div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { setAction(null); setReason('') }}>Cancel</Button><Button variant="primary" disabled={!reason.trim() || busy} isLoading={busy} onClick={() => void submitAction()}>Confirm</Button></div></section></div>}
    </main>
  )
}
