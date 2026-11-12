import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Ban, Download, RotateCcw } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { routes } from '../../lib/routes'
import { showToast } from '../../lib/feedback'
import type { AdminCompanyDetail } from './types'

export function AdminCompanyDetailPage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<AdminCompanyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not-found' | 'load' | null>(null)
  const [busy, setBusy] = useState(false)
  const [accountAction, setAccountAction] = useState<'suspend' | 'reactivate' | null>(null)
  const [reason, setReason] = useState('')

  const load = async () => {
    if (!userId) return
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<AdminCompanyDetail>(`/admin/companies/${userId}`)
      setDetail(response.data)
    } catch (requestError) {
      const status = (requestError as { response?: { status?: number } }).response?.status
      setError(status === 404 ? 'not-found' : 'load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [userId])

  const verify = async (status: 'VERIFIED' | 'REJECTED') => {
    if (!userId) return
    const reasonText = status === 'REJECTED' ? window.prompt('Reason for rejecting this company?')?.trim() : undefined
    if (status === 'REJECTED' && !reasonText) return
    setBusy(true)
    try {
      await api.post(`/admin/companies/${userId}/verification`, { status, ...(reasonText ? { reason: reasonText } : {}) })
      await load()
      showToast(status === 'VERIFIED' ? 'Company verified.' : 'Company verification rejected.', 'success')
    } catch (requestError) {
      const message = (requestError as { response?: { data?: { detail?: string } } }).response?.data?.detail
      showToast(message || 'Could not update company verification.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const updateAccount = async () => {
    if (!userId || !accountAction || !reason.trim()) return
    setBusy(true)
    try {
      await api.post(`/admin/users/${userId}/${accountAction}`, { reason: reason.trim() })
      setAccountAction(null)
      setReason('')
      await load()
      showToast(accountAction === 'suspend' ? 'Company account suspended.' : 'Company account reactivated.', 'success')
    } catch {
      showToast('Could not update this account.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const downloadDocument = async (documentId: number, filename: string) => {
    if (!userId) return
    try {
      const response = await api.get<Blob>(`/admin/companies/${userId}/documents/${documentId}/download`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      window.URL.revokeObjectURL(url)
    } catch {
      showToast('Could not download the verification document.', 'error')
    }
  }

  if (loading) return <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8"><div className="h-28 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />)}</main>
  if (error === 'not-found') return <main className="mx-auto max-w-3xl px-4 py-12"><Card className="p-8 text-center dark:bg-slate-900"><h1 className="text-xl font-bold">Company not found</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This account may not exist or is not a company account.</p><Button className="mt-5" variant="outline" onClick={() => navigate(routes.adminCompanies)}><ArrowLeft className="mr-2 h-4 w-4" />Back to companies</Button></Card></main>
  if (error || !detail) return <main className="mx-auto max-w-3xl px-4 py-12"><div role="alert" className="glass-static rounded-2xl border border-rose-200 bg-white p-8 text-center dark:border-rose-900 dark:bg-slate-900"><p className="font-semibold">Company details could not be loaded.</p><Button className="mt-4" variant="outline" onClick={() => void load()}>Retry</Button></div></main>

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <Link to={routes.adminCompanies} className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"><ArrowLeft className="h-4 w-4" />Companies</Link>
      <header className="glass-static flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div><p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Company profile · #{detail.account.user_id}</p><h1 className="mt-1 text-2xl font-bold">{detail.profile.company_name}</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{detail.account.email}</p><span className="mt-3 inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{detail.profile.verification_status}</span></div>
        <div className="flex flex-wrap gap-2">
          {detail.profile.verification_status !== 'VERIFIED' && <Button variant="primary" disabled={busy} isLoading={busy} onClick={() => void verify('VERIFIED')}>Verify</Button>}
          {detail.profile.verification_status !== 'REJECTED' && <Button variant="outline" className="text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => void verify('REJECTED')}>Reject</Button>}
          {detail.account.suspended_at ? <Button variant="outline" disabled={busy} onClick={() => setAccountAction('reactivate')}><RotateCcw className="mr-2 h-4 w-4" />Reactivate</Button> : <Button variant="outline" className="text-rose-700 dark:text-rose-300" disabled={busy} onClick={() => setAccountAction('suspend')}><Ban className="mr-2 h-4 w-4" />Suspend</Button>}
        </div>
      </header>
      <div role="note" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />Contains personal data. Views are logged.</div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Profile</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><dt>Industry</dt><dd>{detail.profile.industry}</dd><dt>Website</dt><dd className="break-all">{detail.profile.website || '—'}</dd><dt>Size</dt><dd>{detail.profile.company_size || '—'}</dd><dt>Location</dt><dd>{detail.profile.location || '—'}</dd></dl><p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{detail.profile.description || 'No description provided.'}</p></Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Account</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><dt>Verified</dt><dd>{detail.account.is_verified ? 'Yes' : 'No'}</dd><dt>Active</dt><dd>{detail.account.is_active ? 'Yes' : 'No'}</dd><dt>MFA enabled</dt><dd>{detail.account.mfa_enabled ? 'Yes' : 'No'}</dd><dt>Created</dt><dd>{new Date(detail.account.created_at).toLocaleDateString()}</dd><dt>Suspended</dt><dd>{detail.account.suspended_at ? new Date(detail.account.suspended_at).toLocaleDateString() : 'No'}</dd></dl></Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Recruiter contact</h2><dl className="mt-3 space-y-2 break-words text-sm"><div><dt className="font-semibold">Name</dt><dd>{detail.profile.recruiter_contact_name || '—'}</dd></div><div><dt className="font-semibold">Email</dt><dd>{detail.profile.recruiter_contact_email || '—'}</dd></div><div><dt className="font-semibold">Phone</dt><dd>{detail.profile.recruiter_contact_phone || '—'}</dd></div></dl></Card>
        <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Documents</h2>{detail.documents.length ? <ul className="mt-3 space-y-2">{detail.documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><div className="min-w-0"><p className="break-all text-sm font-semibold">{document.original_filename}</p><p className="text-xs text-slate-500">{document.document_type} · {(document.file_size / 1024).toFixed(0)} KB · {new Date(document.uploaded_at).toLocaleDateString()}</p></div><Button variant="outline" size="sm" onClick={() => void downloadDocument(document.id, document.original_filename)}><Download className="mr-2 h-4 w-4" />Download</Button></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No verification documents.</p>}</Card>
      </div>
      <Card className="p-5 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Metrics</h2><Link to={routes.adminCompanyPostings(detail.account.user_id)} className="text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Open postings moderation</Link></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[['Active roles', detail.metrics.active_roles], ['Total internships', detail.metrics.total_internships], ['Applicants', detail.metrics.total_applicants], ['Shortlisted', detail.metrics.shortlisted], ['Interviews', detail.metrics.interviews_scheduled], ['Offers', detail.metrics.offers]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div></Card>
      <Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Postings <span className="text-sm font-normal text-slate-500">({detail.postings_total} total)</span></h2>{detail.postings.length ? <ul className="mt-3 space-y-2">{detail.postings.map((posting) => <li key={posting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><div><Link to={routes.adminCompanyPostings(detail.account.user_id)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">{posting.title}</Link><p className="text-xs text-slate-500">{posting.status} · deadline {posting.deadline} · {posting.applicant_count} applicants</p></div><span className="text-xs text-slate-500">{new Date(posting.created_at).toLocaleDateString()}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No postings.</p>}</Card>
      <div className="grid gap-4 md:grid-cols-2"><Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Verification history</h2>{detail.verification_history.length ? <ul className="mt-3 space-y-2">{detail.verification_history.map((event, index) => <li key={`${event.date}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"><p className="font-semibold">{event.action.replaceAll('_', ' ')}</p><p className="text-xs text-slate-500">{event.actor_email || 'Admin'} · {new Date(event.date).toLocaleString()}</p>{event.reason && <p className="mt-1 break-words text-sm">{event.reason}</p>}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No verification changes recorded.</p>}</Card><Card className="p-5 dark:bg-slate-900"><h2 className="font-bold">Recent audit events</h2>{detail.recent_audit_events.length ? <ul className="mt-3 space-y-2">{detail.recent_audit_events.map((event) => <li key={event.id} className="text-sm"><span className="font-semibold">{event.action}</span><span className="ml-2 text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No recent events.</p>}</Card></div>
      {accountAction && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="company-action-title" className="glass-strong w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"><h2 id="company-action-title" className="text-lg font-bold">{accountAction === 'suspend' ? 'Suspend company' : 'Reactivate company'}</h2><label htmlFor="company-action-reason" className="mt-4 block text-sm font-semibold">Reason</label><textarea id="company-action-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} className="glass-input mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950" /><div className="mt-4 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { setAccountAction(null); setReason('') }}>Cancel</Button><Button variant="primary" disabled={!reason.trim() || busy} isLoading={busy} onClick={() => void updateAccount()}>Confirm</Button></div></section></div>}
    </main>
  )
}
