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
import {
  Plus,
  Users,
  Calendar,
  MessageSquare,
  CheckCircle2,
  Download,
  AlertCircle,
  Send,
} from 'lucide-react'

// --- 1. Company Jobs Management ---

export function CompanyJobsPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<number | null>(null)

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Internship Postings</h1>
          <p className="text-xs text-slate-500 mt-1">
            Create, moderate, and track candidates across your open positions.
          </p>
        </div>
        <Link to="/company/internships/new">
          <Button size="sm" variant="primary" leftIcon={<Plus className="w-4 h-4" />}>
            Post New Role
          </Button>
        </Link>
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Applicant Pipeline</h1>
          <p className="text-xs text-slate-500 mt-1">Review student applications, qualifications, and progress stages.</p>
        </div>
        <Link to="/company/jobs">
          <Button variant="outline" size="sm">
            Back to Listings
          </Button>
        </Link>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchApplicants} />
      ) : applicants.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Candidates will appear here as soon as students submit their applications."
        />
      ) : (
        <div className="space-y-4">
          {applicants.map((app) => (
            <Card key={app.id} className="p-5 bg-white space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">
                      {app.student_name || `Applicant #${app.student_id}`}
                    </h3>
                    <Badge status={app.status}>{app.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    {app.student_university || 'Student'} • {app.student_major || 'Major N/A'} • Class of{' '}
                    {app.student_grad_year || 'N/A'}
                  </p>
                  {app.cover_note && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2">
                      <strong className="text-slate-700">Cover Note:</strong> {app.cover_note}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {app.resume_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadResume(app)}
                      leftIcon={<Download className="w-3.5 h-3.5" />}
                    >
                      Resume
                    </Button>
                  )}
                  <Link to="/messages">
                    <Button size="sm" variant="outline" leftIcon={<MessageSquare className="w-3.5 h-3.5" />}>
                      Message
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Stage Progression Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                  Stage Pipeline:
                </span>

                <div className="flex items-center gap-2 flex-wrap">
                  {app.status === 'APPLIED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateStatus(app.id, 'UNDER_REVIEW')}
                    >
                      Mark Under Review
                    </Button>
                  )}

                  {app.status === 'UNDER_REVIEW' && (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleUpdateStatus(app.id, 'SHORTLISTED')}
                      >
                        Shortlist Candidate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600"
                        onClick={() => handleUpdateStatus(app.id, 'REJECTED')}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {app.status === 'SHORTLISTED' && (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        leftIcon={<Calendar className="w-3.5 h-3.5" />}
                        onClick={() => setActiveInterviewApp(app)}
                      >
                        Schedule Interview
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600"
                        onClick={() => handleUpdateStatus(app.id, 'REJECTED')}
                      >
                        Reject
                      </Button>
                    </>
                  )}

                  {app.status === 'INTERVIEW_SCHEDULED' && (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        onClick={() => handleUpdateStatus(app.id, 'SELECTED')}
                      >
                        Select Candidate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600"
                        onClick={() => handleUpdateStatus(app.id, 'REJECTED')}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
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
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [serverError, setServerError] = useState('')

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
    </div>
  )
}
