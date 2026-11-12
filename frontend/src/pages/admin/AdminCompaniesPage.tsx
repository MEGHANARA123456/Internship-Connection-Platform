import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { SearchBox } from '../../components/ui/SearchBox'
import { routes } from '../../lib/routes'
import type { AdminCompany, AdminPage } from './types'

const pageSizes = [10, 20, 50, 100]

export function AdminCompaniesPage() {
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('q') ?? '')
  const [data, setData] = useState<AdminPage<AdminCompany> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [actionId, setActionId] = useState<number | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const requestKey = params.toString()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParams((current) => {
        const next = new URLSearchParams(current)
        const value = searchText.trim()
        if ((next.get('q') ?? '') === value) return current
        if (value) next.set('q', value)
        else next.delete('q')
        next.delete('page')
        return next
      }, { replace: true })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchText, setParams])

  useEffect(() => {
    setSearchText(params.get('q') ?? '')
  }, [params])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams(requestKey)
    if (!query.has('page')) query.set('page', '1')
    if (!query.has('page_size')) query.set('page_size', '20')
    setLoading(true)
    setError(false)
    api.get<AdminPage<AdminCompany>>(`/admin/companies?${query.toString()}`, { signal: controller.signal })
      .then((response) => setData(response.data))
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [requestKey, retryKey])

  const companies = useMemo(() => data?.items ?? [], [data])
  const page = Number(params.get('page') || '1')
  const pageSize = Number(params.get('page_size') || '20')
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
  const hasActiveFilters = Boolean(searchText.trim() || params.get('verification_status') || params.get('created'))
  const updateParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }
  const clearFilters = () => {
    setSearchText('')
    setParams((current) => {
      const next = new URLSearchParams(current)
      for (const key of ['q', 'verification_status', 'created', 'page']) next.delete(key)
      return next
    })
  }
  const verify = async (company: AdminCompany, status: 'VERIFIED' | 'REJECTED') => {
    const reason = status === 'REJECTED' ? window.prompt('Reason for rejecting this company?')?.trim() : undefined
    if (status === 'REJECTED' && !reason) return
    setActionId(company.user_id)
    try {
      await api.post(`/admin/companies/${company.user_id}/verification`, { status, ...(reason ? { reason } : {}) })
      setRetryKey((value) => value + 1)
    } catch {
      setError(true)
    } finally {
      setActionId(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Admin directory</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Companies</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Review company profiles, verification, roles, and applicant totals.</p>
        </div>
        <Link to={routes.adminUsers()} className="text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Account management</Link>
      </header>

      <section aria-label="Company filters" className={`glass-strong grid items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 ${hasActiveFilters ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <div className="min-w-0 sm:col-span-2 lg:col-span-2">
          <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Search</span>
          <SearchBox
            ariaLabel="Search companies"
            value={searchText}
            onChange={setSearchText}
            scope="companies"
            placeholder="Search name, industry, location or recruiter"
            maxLength={100}
          />
        </div>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Verification status
          <select aria-label="Filter by verification status" value={params.get('verification_status') ?? ''} onChange={(event) => updateParam('verification_status', event.target.value)} className="glass-input mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            <option value="">All statuses</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Created
          <select aria-label="Filter companies by creation date" value={params.get('created') ?? ''} onChange={(event) => updateParam('created', event.target.value)} className="glass-input mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            <option value="">Any time</option><option value="this_month">This month</option>
          </select>
        </label>
        {hasActiveFilters && <Button type="button" variant="outline" className="h-10 rounded-lg" onClick={clearFilters}>Clear filters</Button>}
      </section>

      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="flex h-10 items-center text-sm text-slate-600 dark:text-slate-400">{loading ? 'Loading companies…' : `${data?.total ?? 0} companies`}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">Sort
            <select aria-label="Sort companies" value={params.get('sort') ?? 'created_at'} onChange={(event) => updateParam('sort', event.target.value)} className="glass-input h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="created_at">Created</option><option value="company_name">Name</option><option value="industry">Industry</option><option value="verification_status">Verification</option><option value="posting_count">Roles</option><option value="active_roles">Active roles</option><option value="total_applicants">Applicants</option>
            </select>
          </label>
          <label className="sr-only" htmlFor="company-page-size">Rows per page</label>
          <select id="company-page-size" aria-label="Rows per page" value={pageSize} onChange={(event) => updateParam('page_size', event.target.value)} className="glass-input h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {pageSizes.map((size) => <option key={size} value={size}>{size} / page</option>)}
          </select>
        </div>
      </section>

      {error ? (
        <div role="alert" className="glass-static rounded-2xl border border-rose-200 bg-white p-8 text-center dark:border-rose-900 dark:bg-slate-900">
          <p className="font-semibold text-rose-700 dark:text-rose-300">Companies could not be loaded or updated.</p>
          <Button className="mt-4" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>Retry</Button>
        </div>
      ) : loading ? (
        <div aria-label="Loading companies" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="glass-static h-36 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div>
      ) : companies.length === 0 ? (
        <div className="glass-static rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <EmptyState title="No companies found" description="Change or clear the search and filters to see company accounts." />
        </div>
      ) : (
        <>
          <div className="glass-strong hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
            <table className="w-full min-w-[950px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"><tr><th scope="col" className="p-3">Company</th><th scope="col" className="p-3">Location / industry</th><th scope="col" className="p-3">Verification</th><th scope="col" className="p-3">Roles</th><th scope="col" className="p-3">Applicants</th><th scope="col" className="p-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{companies.map((company) => (
                <tr key={company.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="p-3"><Link to={routes.adminCompanyDetail(company.user_id)} className="font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{company.company_name}</Link><p className="text-xs text-slate-500">{company.company_size ?? 'Company size not set'}</p></td>
                  <td className="p-3"><span className={!company.location || company.location === 'Not provided' ? 'text-slate-500 dark:text-slate-400' : ''}>{company.location || 'Not provided'}</span><p className="text-xs text-slate-500">{company.industry}</p></td>
                  <td className="p-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">{company.verification_status}</span></td>
                  <td className="p-3">{company.active_roles} active / {company.posting_count} total</td><td className="p-3">{company.total_applicants}</td>
                  <td className="p-3 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="primary" disabled={actionId !== null || company.verification_status === 'VERIFIED'} isLoading={actionId === company.user_id} onClick={() => void verify(company, 'VERIFIED')}>Verify</Button><Button size="sm" variant="outline" disabled={actionId !== null || company.verification_status === 'REJECTED'} onClick={() => void verify(company, 'REJECTED')}>Reject</Button><Link to={routes.adminCompanyPostings(company.user_id)} className="self-center text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Postings</Link></div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">{companies.map((company) => (
            <article key={company.user_id} className="glass-static rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link to={routes.adminCompanyDetail(company.user_id)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">{company.company_name}</Link><p className={!company.location || company.location === 'Not provided' ? 'text-xs text-slate-500 dark:text-slate-400' : 'text-xs'}>{company.location || 'Not provided'}</p><p className="text-xs text-slate-500">{company.industry}</p></div><Building2 className="h-5 w-5 shrink-0 text-indigo-500" /></div>
              <p className="mt-3 text-sm">{company.verification_status} · {company.active_roles} active roles · {company.total_applicants} applicants</p>
              <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="primary" disabled={actionId !== null || company.verification_status === 'VERIFIED'} onClick={() => void verify(company, 'VERIFIED')}>Verify</Button><Button size="sm" variant="outline" disabled={actionId !== null || company.verification_status === 'REJECTED'} onClick={() => void verify(company, 'REJECTED')}>Reject</Button><Link to={routes.adminCompanyPostings(company.user_id)} className="self-center text-sm font-semibold text-indigo-700 dark:text-indigo-300">Postings</Link></div>
            </article>
          ))}</div>
          <nav aria-label="Company directory pages" className="glass-static flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <Button variant="outline" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}>Previous</Button>
            <span className="text-sm text-slate-600 dark:text-slate-300">Page {page} of {pages}</span>
            <Button variant="outline" disabled={page >= pages} onClick={() => updateParam('page', String(page + 1))}>Next</Button>
          </nav>
        </>
      )}
    </main>
  )
}
