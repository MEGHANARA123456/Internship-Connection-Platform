import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api, downloadAuthenticatedFile } from '../api/client'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { CardSkeleton, TableSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { ScheduleInterviewModal } from '../components/modals/ScheduleInterviewModal'
import { useAuthStore } from '../store/auth'
import { AccountSecurityCard } from '../components/auth/AccountSecurityCard'
import { WelcomeGreeting } from '../components/dashboard/WelcomeGreeting'
import { AvatarUploadCard } from '../components/ui/AvatarUploadCard'
import {
  Plus,
  Users,
  Calendar,
  MessageSquare,
  CheckCircle2,
  Download,
  AlertCircle,
  Send,
  Kanban,
  LayoutList,
  CheckSquare,
  FileSpreadsheet,
  UserCheck,
  XCircle,
  GripVertical,
} from 'lucide-react'
import { DesktopAnalysisVisuals } from '../components/analytics/DesktopAnalysisVisuals'

// --- 1. Company Jobs Management ---

export function CompanyJobsPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [schedulingJob, setSchedulingJob] = useState<{ id: number; title: string } | null>(null)

  const fetchJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/internships/mine')
      setJobs(res.data || [])
    } catch {
      setError('Failed to fetch your internship listings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  const handleSubmitForApproval = async (jobId: number) => {
    setSubmittingId(jobId)
    try {
      await api.post(`/internships/${jobId}/submit`)
      fetchJobs()
    } catch {
      alert('Failed to submit internship for approval.')
    } finally {
      setSubmittingId(null)
    }
  }

  const handleCloseListing = async (jobId: number) => {
    if (!confirm('Are you sure you want to close this listing to new applicants?')) return
    try {
      await api.post(`/internships/${jobId}/close`)
      fetchJobs()
    } catch {
      alert('Failed to close internship.')
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <WelcomeGreeting
        role="COMPANY"
        customSubtitle="Welcome to your hiring command center. Review candidate applications, publish new roles, and coordinate interviews."
        className="mb-6"
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Internship Postings</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Create, moderate, and track candidates across your open positions.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <Link to="/interviews">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
              className="border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
            >
              Interview Scheduling
            </Button>
          </Link>
          <Link to="/company/internships/new">
            <Button size="sm" variant="primary" leftIcon={<Plus className="w-4 h-4" />}>
              Post New Role
            </Button>
          </Link>
        </div>
      </div>

      {/* Desktop Hiring Pipeline & Conversion Visuals */}
      <div className="hidden md:block mb-8">
        <DesktopAnalysisVisuals
          variant="company"
          title="Company Hiring Pipeline & Conversion Analytics"
          subtitle="Real-time candidate screening velocity, recruitment funnel progression, and market distribution"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchJobs} />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No internships posted yet"
          description="Create your first internship listing to start receiving applications from verified candidates."
          actionLabel="Post an Internship"
          onAction={() => (window.location.href = '/company/internships/new')}
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id} className="p-5 bg-white">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">{job.title}</h3>
                    <Badge status={job.status}>{job.status}</Badge>
                    <Badge variant="slate">{job.work_mode}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {job.industry} • {job.location} • ${job.stipend}/mo • {job.duration_months} mo
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <Link to={`/company/jobs/${job.id}/applicants`}>
                    <Button size="sm" variant="outline" leftIcon={<Users className="w-3.5 h-3.5" />}>
                      View Applicants
                    </Button>
                  </Link>

                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Calendar className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                    className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => setSchedulingJob({ id: job.id, title: job.title })}
                  >
                    Interview Scheduling
                  </Button>

                  {job.status === 'DRAFT' && (
                    <>
                      <Link to={`/company/internships/${job.id}/edit`}>
                        <Button size="sm" variant="ghost">
                          Edit
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="primary"
                        isLoading={submittingId === job.id}
                        onClick={() => handleSubmitForApproval(job.id)}
                        leftIcon={<Send className="w-3.5 h-3.5" />}
                      >
                        Submit for Review
                      </Button>
                    </>
                  )}

                  {job.status === 'PUBLISHED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50"
                      onClick={() => handleCloseListing(job.id)}
                    >
                      Close Role
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {schedulingJob && (
        <ScheduleInterviewModal
          isOpen={!!schedulingJob}
          onClose={() => setSchedulingJob(null)}
          jobId={schedulingJob.id}
          jobTitle={schedulingJob.title}
          onScheduled={() => {
            fetchJobs()
          }}
        />
      )}
    </div>
  )
}

// --- 2. Create & Edit Internship Form ---

const jobFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().min(20, 'Provide a detailed description of duties and qualifications'),
  location: z.string().min(2, 'Location is required (e.g. Remote or San Francisco, CA)'),
  industry: z.string().min(2, 'Industry is required'),
  duration_months: z.coerce.number().min(1, 'Duration must be at least 1 month').max(24),
  stipend: z.coerce.number().min(0, 'Stipend must be 0 or greater'),
  work_mode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']),
  deadline: z.string().min(1, 'Application deadline is required'),
  skills: z.string().optional().or(z.literal('')),
})

export function JobFormPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditing = Boolean(id)

  const [loading, setLoading] = useState(isEditing)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof jobFormSchema>>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      work_mode: 'REMOTE',
      duration_months: 3,
      stipend: 1500,
    },
  })

  useEffect(() => {
    if (!id) return
    const fetchExisting = async () => {
      try {
        const res = await api.get(`/internships/${id}`)
        const data = res.data
        setValue('title', data.title)
        setValue('description', data.description)
        setValue('location', data.location)
        setValue('industry', data.industry)
        setValue('duration_months', data.duration_months)
        setValue('stipend', data.stipend)
        setValue('work_mode', data.work_mode)
        setValue('deadline', data.deadline || '')
        setValue('skills', Array.isArray(data.skills) ? data.skills.join(', ') : data.skills || '')
      } catch {
        setServerError('Failed to load internship details.')
      } finally {
        setLoading(false)
      }
    }
    fetchExisting()
  }, [id, setValue])

  const onSubmit = async (data: z.infer<typeof jobFormSchema>) => {
    setServerError('')
    try {
      const payload = {
        title: data.title,
        description: data.description,
        location: data.location,
        industry: data.industry,
        duration_months: data.duration_months,
        stipend: data.stipend,
        work_mode: data.work_mode,
        deadline: data.deadline,
        skills: data.skills ? data.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      }

      if (isEditing) {
        await api.put(`/internships/${id}`, payload)
      } else {
        await api.post('/internships', payload)
      }
      navigate('/company/jobs')
    } catch {
      setServerError('Failed to save internship. Please review your inputs.')
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <CardSkeleton />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 w-full">
      <Card className="bg-white">
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit Internship' : 'Post an Internship'}</CardTitle>
          <CardDescription>
            {isEditing
              ? 'Update listing details. Edits are saved as Draft until submitted for moderation.'
              : 'Create a new internship posting for student applicants.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {serverError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Input
              label="Job Title"
              placeholder="e.g. Software Engineering Intern (Summer 2026)"
              error={errors.title?.message}
              {...register('title')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Location"
                placeholder="e.g. Remote, or New York, NY"
                error={errors.location?.message}
                {...register('location')}
              />
              <Input
                label="Industry"
                placeholder="e.g. Technology, Finance, Media"
                error={errors.industry?.message}
                {...register('industry')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="Work Mode"
                options={[
                  { label: 'Remote', value: 'REMOTE' },
                  { label: 'Hybrid', value: 'HYBRID' },
                  { label: 'On-site', value: 'ONSITE' },
                ]}
                error={errors.work_mode?.message}
                {...register('work_mode')}
              />

              <Input
                label="Duration (Months)"
                type="number"
                min={1}
                max={24}
                error={errors.duration_months?.message}
                {...register('duration_months')}
              />

              <Input
                label="Monthly Stipend ($USD)"
                type="number"
                min={0}
                error={errors.stipend?.message}
                {...register('stipend')}
              />
            </div>

            <Input
              label="Application Deadline (Optional)"
              type="date"
              error={errors.deadline?.message}
              {...register('deadline')}
            />

            <Input
              label="Required Skills / Keywords"
              placeholder="React, TypeScript, Python, PostgreSQL"
              helperText="Comma separated list of keywords"
              error={errors.skills?.message}
              {...register('skills')}
            />

            <Textarea
              label="Full Description & Requirements"
              placeholder="Describe candidate responsibilities, day-to-day work, and desired experience..."
              rows={6}
              error={errors.description?.message}
              {...register('description')}
            />

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
              <Button type="button" variant="outline" size="sm" onClick={() => navigate('/company/jobs')}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                {isEditing ? 'Save Changes' : 'Create Internship (Draft)'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// --- 3. Job Applicants Pipeline ---

export function JobApplicantsPage() {
  const { id } = useParams()
  const [applicants, setApplicants] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeInterviewApp, setActiveInterviewApp] = useState<any | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')
  const [selectedAppIds, setSelectedAppIds] = useState<Set<number>>(new Set())
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [draggedAppId, setDraggedAppId] = useState<number | null>(null)
  const [mobileStageFilter, setMobileStageFilter] = useState<string>('ALL')

  const fetchApplicants = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/applications/internships/${id}`)
      setApplicants(res.data || [])
    } catch {
      setError('Failed to fetch applicants for this internship.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApplicants()
  }, [id])

  const handleUpdateStatus = async (appId: number, newStatus: string) => {
    try {
      if (newStatus === 'UNDER_REVIEW') {
        await api.patch(`/applications/${appId}/review`)
      } else if (newStatus === 'SHORTLISTED') {
        await api.patch(`/applications/${appId}/shortlist`)
      } else if (newStatus === 'SELECTED') {
        await api.patch(`/applications/${appId}/select`)
      } else if (newStatus === 'REJECTED') {
        await api.patch(`/applications/${appId}/reject`)
      }
      fetchApplicants()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to update candidate stage.')
    }
  }

  const handleDownloadResume = async (app: any) => {
    if (!app.resume_id) {
      alert('This candidate has not attached a resume.')
      return
    }
    try {
      await downloadAuthenticatedFile(`/profiles/resume/${app.resume_id}/download`, `resume_candidate_${app.student_id}.pdf`)
    } catch {
      alert('Failed to download candidate resume.')
    }
  }

  // Multi-select toggle
  const toggleSelectApp = (appId: number) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedAppIds.size === applicants.length) {
      setSelectedAppIds(new Set())
    } else {
      setSelectedAppIds(new Set(applicants.map((a) => a.id)))
    }
  }

  // Bulk actions
  const handleBulkShortlist = async () => {
    if (selectedAppIds.size === 0) return
    setBulkProcessing(true)
    try {
      await api.post('/applications/bulk-status', {
        application_ids: Array.from(selectedAppIds),
        status: 'SHORTLISTED',
      })
      setSelectedAppIds(new Set())
      await fetchApplicants()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to bulk shortlist candidates')
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleBulkReject = async () => {
    if (selectedAppIds.size === 0) return
    if (!confirm(`Are you sure you want to reject ${selectedAppIds.size} selected candidate(s)?`)) return
    setBulkProcessing(true)
    try {
      await api.post('/applications/bulk-status', {
        application_ids: Array.from(selectedAppIds),
        status: 'REJECTED',
      })
      setSelectedAppIds(new Set())
      await fetchApplicants()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to bulk reject candidates')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Export CSV
  const handleExportCSV = () => {
    const appsToExport = selectedAppIds.size > 0
      ? applicants.filter((a) => selectedAppIds.has(a.id))
      : applicants

    const headers = ['Application ID', 'Student Name', 'Status', 'University', 'Cover Note', 'Applied Date']
    const rows = appsToExport.map((a) => [
      a.id,
      `"${(a.student_name || 'N/A').replace(/"/g, '""')}"`,
      a.status,
      `"${(a.student_university || 'N/A').replace(/"/g, '""')}"`,
      `"${(a.cover_note || '').replace(/"/g, '""')}"`,
      new Date(a.created_at).toLocaleDateString(),
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `applicants_internship_${id}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, appId: number) => {
    e.dataTransfer.setData('text/plain', String(appId))
    setDraggedAppId(appId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetStatus: string) => {
    e.preventDefault()
    const appIdStr = e.dataTransfer.getData('text/plain')
    const appId = Number(appIdStr)
    setDraggedAppId(null)

    if (!appId) return
    const app = applicants.find((a) => a.id === appId)
    if (!app || app.status === targetStatus) return

    if (targetStatus === 'INTERVIEW_SCHEDULED') {
      setActiveInterviewApp(app)
    } else {
      handleUpdateStatus(appId, targetStatus)
    }
  }

  const STAGES = [
    { id: 'APPLIED', title: 'Applied', color: 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400' },
    { id: 'UNDER_REVIEW', title: 'Under Review', color: 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400' },
    { id: 'SHORTLISTED', title: 'Shortlisted', color: 'border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400' },
    { id: 'INTERVIEW_SCHEDULED', title: 'Interviewing', color: 'border-cyan-500 bg-cyan-50/40 dark:bg-cyan-950/20 text-cyan-700 dark:text-cyan-400' },
    { id: 'SELECTED', title: 'Selected / Offer', color: 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' },
    { id: 'REJECTED', title: 'Archived', color: 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400' },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Header Bar */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Applicant Pipeline</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Drag candidates between stages or manage actions in bulk • {applicants.length} Total Applicants
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* View Mode Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-100 dark:bg-slate-800 text-xs">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              Table
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
          >
            Export CSV
          </Button>

          <Link to="/company/jobs">
            <Button variant="outline" size="sm">
              Back to Listings
            </Button>
          </Link>
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedAppIds.size > 0 && (
        <div className="mb-5 p-3 bg-indigo-600 dark:bg-indigo-900 text-white rounded-xl shadow-lg flex items-center justify-between gap-3 flex-wrap animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-indigo-200" />
            <span className="text-xs font-semibold">{selectedAppIds.size} Candidate(s) Selected</span>
            <button
              onClick={() => setSelectedAppIds(new Set())}
              className="text-[11px] underline text-indigo-200 hover:text-white ml-2 cursor-pointer"
            >
              Deselect all
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs"
              onClick={handleBulkShortlist}
              isLoading={bulkProcessing}
              leftIcon={<UserCheck className="w-3.5 h-3.5" />}
            >
              Bulk Shortlist
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 border-rose-400/30 text-xs"
              onClick={handleBulkReject}
              isLoading={bulkProcessing}
              leftIcon={<XCircle className="w-3.5 h-3.5" />}
            >
              Bulk Reject
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchApplicants} />
      ) : applicants.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Candidates will appear here as soon as students submit their applications."
        />
      ) : viewMode === 'kanban' ? (
        /* KANBAN BOARD VIEW */
        <div className="space-y-4">
          {/* Mobile Stage Selector Pill Tabs */}
          <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
            <button
              type="button"
              onClick={() => setMobileStageFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                mobileStageFilter === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              All Stages ({applicants.length})
            </button>
            {STAGES.map((s) => {
              const count = applicants.filter((a) => a.status === s.id).length
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setMobileStageFilter(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer ${
                    mobileStageFilter === s.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>{s.title}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/10 dark:bg-white/10 font-bold">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-4 items-start overflow-x-auto pb-4 snap-x snap-mandatory">
            {STAGES.filter((s) => mobileStageFilter === 'ALL' || s.id === mobileStageFilter).map((stage) => {
              const stageApps = applicants.filter((a) => a.status === stage.id)
              return (
                <div
                  key={stage.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, stage.id)}
                  className={`w-[86vw] sm:w-[320px] md:w-auto shrink-0 md:shrink snap-center rounded-2xl border-t-4 border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3 min-h-[500px] flex flex-col space-y-3 transition-colors ${
                    stage.color
                  }`}
                >
                {/* Column Header */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800">
                  <span className="text-xs font-bold tracking-tight">{stage.title}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    {stageApps.length}
                  </span>
                </div>

                {/* Column Cards */}
                <div className="space-y-2.5 flex-1 overflow-y-auto">
                  {stageApps.length === 0 ? (
                    <div className="h-32 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-[11px] text-slate-400 dark:text-slate-500 text-center p-2">
                      Drop here to move
                    </div>
                  ) : (
                    stageApps.map((app) => {
                      const isSelected = selectedAppIds.has(app.id)
                      return (
                        <div
                          key={app.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, app.id)}
                          className={`group relative bg-white dark:bg-slate-800/90 rounded-xl p-3 border shadow-2xs hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                            draggedAppId === app.id ? 'opacity-40 scale-95' : ''
                          } ${
                            isSelected
                              ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                              : 'border-slate-200/90 dark:border-slate-700 hover:border-indigo-400'
                          }`}
                        >
                          {/* Top Row: Checkbox & Name */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectApp(app.id)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {app.student_name || `Applicant #${app.student_id}`}
                              </h4>
                            </div>
                            <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                            {app.student_university || 'Student'}
                          </p>

                          {app.cover_note && (
                            <p className="text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2 bg-slate-50 dark:bg-slate-900/80 p-1.5 rounded mt-2 border border-slate-100 dark:border-slate-800">
                              "{app.cover_note}"
                            </p>
                          )}

                          {/* Action Footers */}
                          <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1">
                              {app.resume_id && (
                                <button
                                  type="button"
                                  onClick={() => handleDownloadResume(app)}
                                  title="Download Resume"
                                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                                >
                                  <Download className="w-3 h-3" />
                                </button>
                              )}
                              <Link to="/messages">
                                <button
                                  type="button"
                                  title="Send Message"
                                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                </button>
                              </Link>
                            </div>

                            {/* Stage Step Quick Button */}
                            {stage.id === 'APPLIED' && (
                              <button
                                onClick={() => handleUpdateStatus(app.id, 'UNDER_REVIEW')}
                                className="text-[10px] px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800 hover:bg-amber-100"
                              >
                                Review →
                              </button>
                            )}
                            {stage.id === 'UNDER_REVIEW' && (
                              <button
                                onClick={() => handleUpdateStatus(app.id, 'SHORTLISTED')}
                                className="text-[10px] px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-semibold border border-purple-200 dark:border-purple-800 hover:bg-purple-100"
                              >
                                Shortlist →
                              </button>
                            )}
                            {stage.id === 'SHORTLISTED' && (
                              <button
                                onClick={() => setActiveInterviewApp(app)}
                                className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 flex items-center gap-1"
                              >
                                <Calendar className="w-2.5 h-2.5" />
                                Interview
                              </button>
                            )}
                            {stage.id === 'INTERVIEW_SCHEDULED' && (
                              <button
                                onClick={() => handleUpdateStatus(app.id, 'SELECTED')}
                                className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100"
                              >
                                Select ✓
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="p-3.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectedAppIds.size === applicants.length && applicants.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="p-3.5">Candidate</th>
                <th className="p-3.5">University</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Applied Date</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {applicants.map((app) => {
                const isSelected = selectedAppIds.has(app.id)
                return (
                  <tr
                    key={app.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                      isSelected ? 'bg-indigo-50/40 dark:bg-indigo-950/30' : ''
                    }`}
                  >
                    <td className="p-3.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectApp(app.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                      {app.student_name || `Applicant #${app.student_id}`}
                      {app.cover_note && (
                        <p className="text-[11px] font-normal text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                          {app.cover_note}
                        </p>
                      )}
                    </td>
                    <td className="p-3.5 text-slate-600 dark:text-slate-300">
                      {app.student_university || 'N/A'}
                    </td>
                    <td className="p-3.5">
                      <Badge status={app.status}>{app.status}</Badge>
                    </td>
                    <td className="p-3.5 text-slate-500 dark:text-slate-400">
                      {new Date(app.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-3.5 text-right space-x-2">
                      {app.resume_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownloadResume(app)}
                          leftIcon={<Download className="w-3 h-3" />}
                        >
                          Resume
                        </Button>
                      )}
                      {app.status === 'APPLIED' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateStatus(app.id, 'UNDER_REVIEW')}
                          >
                            Review
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            leftIcon={<Calendar className="w-3 h-3" />}
                            onClick={() => setActiveInterviewApp(app)}
                          >
                            Schedule
                          </Button>
                        </>
                      )}
                      {app.status === 'UNDER_REVIEW' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUpdateStatus(app.id, 'SHORTLISTED')}
                          >
                            Shortlist
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            leftIcon={<Calendar className="w-3 h-3" />}
                            onClick={() => setActiveInterviewApp(app)}
                          >
                            Schedule
                          </Button>
                        </>
                      )}
                      {app.status === 'SHORTLISTED' && (
                        <Button
                          size="sm"
                          variant="primary"
                          leftIcon={<Calendar className="w-3 h-3" />}
                          onClick={() => setActiveInterviewApp(app)}
                        >
                          Schedule
                        </Button>
                      )}
                      {app.status === 'INTERVIEW_SCHEDULED' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<Calendar className="w-3 h-3" />}
                            onClick={() => setActiveInterviewApp(app)}
                          >
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="success"
                            leftIcon={<CheckCircle2 className="w-3 h-3" />}
                            onClick={() => handleUpdateStatus(app.id, 'SELECTED')}
                          >
                            Select
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Schedule Interview Modal */}
      {activeInterviewApp && (
        <ScheduleInterviewModal
          isOpen={!!activeInterviewApp}
          onClose={() => setActiveInterviewApp(null)}
          applicationId={activeInterviewApp.id}
          candidateName={activeInterviewApp.student_name}
          onScheduled={() => {
            fetchApplicants()
          }}
        />
      )}
    </div>
  )
}

// --- 4. Company Profile Page ---

const companyProfileSchema = z.object({
  company_name: z.string().min(2, 'Company name is required'),
  industry: z.string().min(2, 'Industry is required'),
  website: z.string().url().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
})

export function CompanyProfilePage() {
  const session = useAuthStore((state) => state.session)
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [serverError, setServerError] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(session?.avatar_url || null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof companyProfileSchema>>({
    resolver: zodResolver(companyProfileSchema),
  })

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await api.get('/profiles/company')
        setProfile(res.data)
        setValue('company_name', res.data.company_name)
        setValue('industry', res.data.industry)
        setValue('website', res.data.website || '')
        setValue('description', res.data.description || '')
        if (res.data.avatar_url) {
          setAvatarUrl(res.data.avatar_url)
          useAuthStore.getState().updateAvatar(res.data.avatar_url)
        }
      } catch {
        setServerError('Failed to load company profile.')
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [setValue])

  const onSubmit = async (data: z.infer<typeof companyProfileSchema>) => {
    setServerError('')
    try {
      await api.put('/profiles/company', data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setServerError('Failed to save profile changes.')
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <CardSkeleton />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Company Profile</h1>
        <p className="text-xs text-slate-500 mt-1">Manage public organization details and verification status.</p>
      </div>

      {/* Company Brand Logo / Avatar Upload */}
      <AvatarUploadCard
        currentAvatarUrl={avatarUrl}
        name={profile?.company_name || 'Organization'}
        roleLabel="Hiring Employer"
        onAvatarUpdated={(newUrl) => setAvatarUrl(newUrl)}
      />

      {profile && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Verification Status
            </span>
            <p className="text-sm font-bold text-slate-800">{profile.company_name}</p>
          </div>
          <Badge status={profile.verification_status}>{profile.verification_status}</Badge>
        </div>
      )}

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
          <CardDescription>Students see these details when browsing your internship postings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {saved && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Company profile updated successfully!</span>
              </div>
            )}

            {serverError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            <Input
              label="Company Name"
              error={errors.company_name?.message}
              {...register('company_name')}
            />

            <Input
              label="Industry"
              error={errors.industry?.message}
              {...register('industry')}
            />

            <Input
              label="Website"
              type="url"
              error={errors.website?.message}
              {...register('website')}
            />

            <Textarea
              label="Company Overview"
              rows={4}
              error={errors.description?.message}
              {...register('description')}
            />

            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              Save Profile
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Account Security & Password */}
      <AccountSecurityCard userEmail={session?.email} role="Company" />
    </div>
  )
}
