import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { SearchBox } from '../../components/ui/SearchBox'
import { routes } from '../../lib/routes'
import type { AdminPage, AdminStudent } from './types'

const pageSizes = [10, 20, 50, 100]

export function AdminStudentsPage() {
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('q') ?? '')
  const [data, setData] = useState<AdminPage<AdminStudent> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
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
    api.get<AdminPage<AdminStudent>>(`/admin/students?${query.toString()}`, { signal: controller.signal })
      .then((response) => setData(response.data))
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [requestKey, retryKey])

  const currentPage = Number(params.get('page') || '1')
  const pageSize = Number(params.get('page_size') || '20')
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
  const updateParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }
  const students = useMemo(() => data?.items ?? [], [data])

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Admin directory</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Students</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Find student accounts and review profile and application totals.</p>
        </div>
        <Link to={routes.adminUsers()} className="text-sm font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Account management</Link>
      </header>

      <section aria-label="Student filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-5">
        <SearchBox
          ariaLabel="Search students"
          value={searchText}
          onChange={setSearchText}
          scope="students"
          placeholder="Search name, email, university, major or skill"
          maxLength={100}
          className="h-11 sm:col-span-2 lg:col-span-2"
        />
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Verification
          <select aria-label="Filter by verification" value={params.get('verified') ?? ''} onChange={(event) => updateParam('verified', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            <option value="">All</option><option value="true">Verified</option><option value="false">Not verified</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Account status
          <select aria-label="Filter by suspension" value={params.get('suspended') ?? ''} onChange={(event) => updateParam('suspended', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">
            <option value="">All</option><option value="false">Active</option><option value="true">Suspended</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Graduation year
          <input aria-label="Filter by graduation year" type="number" min="1990" max="2100" value={params.get('graduation_year') ?? ''} onChange={(event) => updateParam('graduation_year', event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        </label>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">{loading ? 'Loading students…' : `${data?.total ?? 0} students`}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 dark:text-slate-400">Sort
            <select aria-label="Sort students" value={params.get('sort') ?? 'created_at'} onChange={(event) => updateParam('sort', event.target.value)} className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              <option value="created_at">Created</option><option value="full_name">Name</option><option value="university">University</option><option value="graduation_year">Graduation year</option><option value="applications_count">Applications</option><option value="badges_count">Valid badges</option>
            </select>
          </label>
          <label className="sr-only" htmlFor="student-page-size">Rows per page</label>
          <select id="student-page-size" aria-label="Rows per page" value={pageSize} onChange={(event) => updateParam('page_size', event.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {pageSizes.map((size) => <option key={size} value={size}>{size} / page</option>)}
          </select>
        </div>
      </section>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8 text-center dark:border-rose-900 dark:bg-slate-900">
          <p className="font-semibold text-rose-700 dark:text-rose-300">Students could not be loaded.</p>
          <Button className="mt-4" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>Retry</Button>
        </div>
      ) : loading ? (
        <><div aria-label="Loading students" className="grid gap-3 md:hidden">{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />)}</div><div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse border-b border-slate-100 dark:border-slate-800" />)}</div></>
      ) : students.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <EmptyState title="No students found" description="Change or clear the search and filters to see student accounts." />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"><tr><th scope="col" className="p-3">Student</th><th scope="col" className="p-3">University / Major</th><th scope="col" className="p-3">Graduation</th><th scope="col" className="p-3">Applications</th><th scope="col" className="p-3">Valid badges</th><th scope="col" className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{students.map((student) => (
                <tr key={student.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="p-3"><Link to={routes.adminStudentDetail(student.user_id)} className="font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">{student.full_name || student.email}</Link><p className="text-xs text-slate-500">{student.email}</p></td>
                  <td className="p-3">{student.university || 'Profile missing'}<p className="text-xs text-slate-500">{student.major || '—'}</p></td>
                  <td className="p-3">{student.graduation_year ?? '—'}</td><td className="p-3">{student.applications_count}</td><td className="p-3">{student.badges_count}</td>
                  <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${student.suspended_at ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : student.is_verified ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'}`}>{student.suspended_at ? 'Suspended' : student.is_verified ? 'Verified' : 'Not verified'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">{students.map((student) => (
            <Link key={student.user_id} to={routes.adminStudentDetail(student.user_id)} className="rounded-2xl border border-slate-200 bg-white p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="truncate font-semibold">{student.full_name || student.email}</h2><p className="truncate text-xs text-slate-500">{student.email}</p></div><Users className="h-5 w-5 shrink-0 text-indigo-500" /></div>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{student.university || 'Profile missing'} · {student.graduation_year ?? '—'}</p>
              <p className="mt-1 text-xs text-slate-500">{student.applications_count} applications · {student.badges_count} valid badges</p>
              <span className="mt-3 inline-block text-xs font-semibold text-indigo-700 dark:text-indigo-300">{student.suspended_at ? 'Suspended' : student.is_verified ? 'Verified' : 'Not verified'}</span>
            </Link>
          ))}</div>
          <nav aria-label="Student directory pages" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <Button variant="outline" disabled={currentPage <= 1} onClick={() => updateParam('page', String(currentPage - 1))}>Previous</Button>
            <span className="text-sm text-slate-600 dark:text-slate-300">Page {currentPage} of {pages}</span>
            <Button variant="outline" disabled={currentPage >= pages} onClick={() => updateParam('page', String(currentPage + 1))}>Next</Button>
          </nav>
        </>
      )}
    </main>
  )
}
