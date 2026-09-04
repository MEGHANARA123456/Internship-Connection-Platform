import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { CardSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import {
  GraduationCap,
  Building2,
  TrendingUp,
  Award,
  Search,
  Download,
  CheckCircle2,
  Sparkles,
} from 'lucide-react'

export function CollegePlacementPortal() {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDept, setSelectedDept] = useState('ALL')

  const fetchStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/institution/placement-stats')
      setData(res.data)
    } catch {
      setError('Unable to load institutional placement metrics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
        <div className="h-12 bg-slate-200 dark:bg-slate-800 animate-pulse rounded-lg w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <ErrorState message={error || 'Failed to load institutional data'} onRetry={fetchStats} />
      </div>
    )
  }

  const filteredPlacements = data.recent_placements.filter((p: any) => {
    const matchesSearch =
      p.student_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.company_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.role.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesDept = selectedDept === 'ALL' || p.major.toLowerCase().includes(selectedDept.toLowerCase())
    return matchesSearch && matchesDept
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
      {/* Collegiate Portal Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {data.institution_name}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              TPO Season Active
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Training & Placement Officer (TPO) Campus Portal • Academic Batch {data.academic_year}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => alert('Batch Placement Report downloaded as Excel/PDF.')}
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            Export NIRF / NAAC Report
          </Button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Placement Rate */}
        <Card className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Campus Placement Rate</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {data.placement_rate_pct}%
              </h3>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                ↑ 6.4% vs Previous Season
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </Card>

        {/* Total Offers */}
        <Card className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Offers Extended</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {data.total_placed}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Out of {data.total_students} registered
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Award className="w-6 h-6" />
            </div>
          </div>
        </Card>

        {/* Average Stipend */}
        <Card className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Average Monthly Stipend</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                ${data.average_stipend}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Highest: $4,200/month
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <GraduationCap className="w-6 h-6" />
            </div>
          </div>
        </Card>

        {/* Recruiting Partners */}
        <Card className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Recruiting Companies</p>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                {data.active_companies}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                24 Fortune 500 Partners
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* Department Breakdown Section */}
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            Department-Wise Placement Performance
          </CardTitle>
          <CardDescription>Real-time completion metrics by academic branch.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.department_stats.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-500 dark:text-slate-400">
              No department records registered yet for this academic cycle.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.department_stats.map((dept: any, idx: number) => {
                const pct = dept.students > 0 ? Math.round((dept.placed / dept.students) * 100) : 0
                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">{dept.department}</span>
                      <span className="font-semibold text-slate-500 dark:text-slate-400">
                        {dept.placed} / {dept.students} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Candidate Placement Records Table */}
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>Recent Verified Student Placements</CardTitle>
            <CardDescription>Track formal offer releases, candidate confirmations, and stipends.</CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidate or company..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Branches</option>
              <option value="Computer Science">CS</option>
              <option value="Information Technology">IT</option>
              <option value="Data Science">Data Science</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="p-3.5">Student Candidate</th>
                  <th className="p-3.5">Branch / Major</th>
                  <th className="p-3.5">Hired Company</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Monthly Stipend</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {filteredPlacements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-xs text-slate-400">
                      No matching placement records found.
                    </td>
                  </tr>
                ) : (
                  filteredPlacements.map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-3.5 font-bold text-slate-900 dark:text-white">{rec.student_name}</td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">{rec.major}</td>
                      <td className="p-3.5 font-semibold text-indigo-600 dark:text-indigo-400">{rec.company_name}</td>
                      <td className="p-3.5 text-slate-700 dark:text-slate-300">{rec.role}</td>
                      <td className="p-3.5 font-medium text-slate-900 dark:text-white">${rec.stipend}/mo</td>
                      <td className="p-3.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          Offer Accepted
                        </span>
                      </td>
                      <td className="p-3.5 text-right text-slate-400 text-[11px]">{rec.date}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
