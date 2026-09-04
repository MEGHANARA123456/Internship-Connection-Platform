import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api, downloadAuthenticatedFile } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { EmptyState } from '../components/ui/EmptyState'
import { CardSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorState } from '../components/ui/ErrorState'
import { ApplyModal } from '../components/modals/ApplyModal'
import { ReportModal } from '../components/modals/ReportModal'
import {
  Search,
  MapPin,
  Clock,
  FileText,
  Upload,
  Download,
  Trash2,
  CheckCircle2,
  Calendar,
  AlertCircle,
  MessageSquare,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

// --- 1. Opportunities Page (Browse Internships) ---

export function OpportunitiesPage() {
  const { session } = useAuthStore()
  const navigate = useNavigate()

  // Filters state
  const [searchTerm, setSearchTerm] = useState('')
  const [location, setLocation] = useState('')
  const [industry, setIndustry] = useState('')
  const [workMode, setWorkMode] = useState('')
  const [minStipend, setMinStipend] = useState('')
  const [skills, setSkills] = useState('')
  const [page, setPage] = useState(1)

  // Data & loading states
  const [internships, setInternships] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Selected for viewing & applying
  const [selectedJob, setSelectedJob] = useState<any | null>(null)
  const [applyModalJob, setApplyModalJob] = useState<any | null>(null)
  const [reportModalJob, setReportModalJob] = useState<any | null>(null)

  const fetchInternships = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (location) params.append('location', location)
      if (industry) params.append('industry', industry)
      if (workMode) params.append('work_mode', workMode)
      if (minStipend) params.append('min_stipend', minStipend)
      if (skills) params.append('skills', skills)
      params.append('page', page.toString())
      params.append('page_size', '10')

      const res = await api.get(`/internships?${params.toString()}`)
      setInternships(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      setError('Failed to fetch internships. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInternships()
  }, [page, location, industry, workMode, minStipend, skills])

  // Filter client-side by keyword search if user typed in title
  const displayedJobs = internships.filter((job) =>
    searchTerm ? job.title.toLowerCase().includes(searchTerm.toLowerCase()) : true
  )

  const handleApplyClick = (job: any) => {
    if (!session) {
      navigate('/login')
      return
    }
    if (session.role !== 'STUDENT') {
      alert('Only student accounts can apply for internships.')
      return
    }
    setApplyModalJob(job)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Explore Internships</h1>
        <p className="text-xs text-slate-500 mt-1">
          Discover verified paid internships, remote roles, and summer placements.
        </p>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs mb-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search by title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div className="relative">
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Location (e.g. Remote, NY)"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                setPage(1)
              }}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <select
            value={workMode}
            onChange={(e) => {
              setWorkMode(e.target.value)
              setPage(1)
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="">All Work Modes</option>
            <option value="REMOTE">Remote</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ONSITE">On-site</option>
          </select>

          <input
            type="text"
            placeholder="Skills (e.g. Python, React)"
            value={skills}
            onChange={(e) => {
              setSkills(e.target.value)
              setPage(1)
            }}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
          <span>
            Found <strong className="text-slate-900">{total}</strong> opportunities
          </span>
          {(location || industry || workMode || minStipend || skills || searchTerm) && (
            <button
              onClick={() => {
                setLocation('')
                setIndustry('')
                setWorkMode('')
                setMinStipend('')
                setSkills('')
                setSearchTerm('')
                setPage(1)
              }}
              className="text-indigo-600 hover:underline font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Main List */}
      {loading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchInternships} />
      ) : displayedJobs.length === 0 ? (
        <EmptyState
          title="No internships found"
          description="Try broadening your search criteria or clearing active filters to see more results."
        />
      ) : (
        <div className="space-y-3">
          {displayedJobs.map((job) => (
            <Card
              key={job.id}
              className="p-5 hover:border-indigo-300 transition-all cursor-pointer bg-white"
              onClick={() => setSelectedJob(job)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 hover:text-indigo-600 transition-colors">
                      {job.title}
                    </h3>
                    <Badge status={job.work_mode}>{job.work_mode}</Badge>
                    <Badge variant="slate">{job.industry}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2 max-w-3xl leading-relaxed">
                    {job.description}
                  </p>
                </div>

                <div className="sm:text-right shrink-0 space-y-2">
                  <div className="text-sm font-semibold text-slate-900">
                    {job.stipend > 0 ? `$${job.stipend}/mo` : 'Unpaid / Experience'}
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleApplyClick(job)
                    }}
                  >
                    Apply Now
                  </Button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {job.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    {job.duration_months} month{job.duration_months > 1 ? 's' : ''}
                  </span>
                  {job.deadline && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Apply by {job.deadline}
                    </span>
                  )}
                </div>

                {job.skills && job.skills.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {job.skills.slice(0, 4).map((s: string) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium"
                      >
                        {s}
                      </span>
                    ))}
                    {job.skills.length > 4 && (
                      <span className="text-[11px] text-slate-400">+{job.skills.length - 4} more</span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}

          {/* Pagination Controls */}
          {total > 10 && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-200 text-xs">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
              >
                Previous
              </Button>
              <span className="text-slate-600 font-medium">
                Page {page} of {Math.ceil(total / 10)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * 10 >= total}
                onClick={() => setPage((p) => p + 1)}
                rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Detailed Internship Modal */}
      {selectedJob && (
        <Modal
          isOpen={!!selectedJob}
          onClose={() => setSelectedJob(null)}
          title={selectedJob.title}
          description={`${selectedJob.industry} • ${selectedJob.location}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs leading-relaxed">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-400 block font-medium">Stipend</span>
                <span className="font-semibold text-slate-800 text-sm">
                  {selectedJob.stipend > 0 ? `$${selectedJob.stipend}/mo` : 'Unpaid'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Duration</span>
                <span className="font-semibold text-slate-800 text-sm">
                  {selectedJob.duration_months} month{selectedJob.duration_months > 1 ? 's' : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Work Mode</span>
                <Badge status={selectedJob.work_mode}>{selectedJob.work_mode}</Badge>
              </div>
              <div>
                <span className="text-slate-400 block font-medium">Deadline</span>
                <span className="font-semibold text-slate-800">{selectedJob.deadline || 'Rolling'}</span>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider mb-1.5">
                Role Description
              </h4>
              <p className="text-slate-600 whitespace-pre-line text-sm">{selectedJob.description}</p>
            </div>

            {selectedJob.skills && selectedJob.skills.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider mb-1.5">
                  Required Competencies
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {selectedJob.skills.map((s: string) => (
                    <Badge key={s} variant="indigo">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReportModalJob(selectedJob)
                  setSelectedJob(null)
                }}
                leftIcon={<ShieldAlert className="w-3.5 h-3.5 text-rose-500" />}
                className="text-rose-600 hover:bg-rose-50"
              >
                Report listing
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedJob(null)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    const j = selectedJob
                    setSelectedJob(null)
                    handleApplyClick(j)
                  }}
                >
                  Apply Now
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Apply Modal */}
      {applyModalJob && (
        <ApplyModal
          isOpen={!!applyModalJob}
          onClose={() => setApplyModalJob(null)}
          internshipId={applyModalJob.id}
          internshipTitle={applyModalJob.title}
          onApplied={() => {
            fetchInternships()
          }}
        />
      )}

      {/* Report Modal */}
      {reportModalJob && (
        <ReportModal
          isOpen={!!reportModalJob}
          onClose={() => setReportModalJob(null)}
          internshipId={reportModalJob.id}
          targetTitle={reportModalJob.title}
        />
      )}
    </div>
  )
}

// --- 2. My Applications Page ---

export function ApplicationsPage() {
  const [applications, setApplications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)

  const fetchApplications = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/applications/student')
      const items = Array.isArray(res.data) ? res.data : res.data?.applications || []
      setApplications(items)
    } catch {
      setError('Unable to load your applications. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchApplications()
  }, [])

  const handleWithdraw = async (appId: number) => {
    if (!confirm('Are you sure you want to withdraw this application? This cannot be undone.')) return
    setWithdrawingId(appId)
    try {
      await api.patch(`/applications/${appId}/withdraw`)
      fetchApplications()
    } catch {
      alert('Failed to withdraw application.')
    } finally {
      setWithdrawingId(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Applications</h1>
          <p className="text-xs text-slate-500 mt-1">Track the status of your internship submissions.</p>
        </div>
        <Link to="/opportunities">
          <Button size="sm" variant="primary">
            Browse More Roles
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchApplications} />
      ) : applications.length === 0 ? (
        <EmptyState
          title="No applications submitted yet"
          description="You have not submitted any internship applications. Explore available listings and apply today!"
          actionLabel="Find Internships"
          onAction={() => (window.location.href = '/opportunities')}
        />
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const canWithdraw = ['APPLIED', 'UNDER_REVIEW', 'SHORTLISTED'].includes(app.status)

            return (
              <Card key={app.id} className="p-5 bg-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900">
                        {app.internship_title || `Internship #${app.internship_id}`}
                      </h3>
                      <Badge status={app.status}>{app.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      Applied on {new Date(app.created_at).toLocaleDateString()}
                    </p>
                    {app.cover_note && (
                      <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-md border border-slate-100 mt-2 italic">
                        "{app.cover_note}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link to="/messages">
                      <Button size="sm" variant="outline" leftIcon={<MessageSquare className="w-3.5 h-3.5" />}>
                        Message Recruiter
                      </Button>
                    </Link>

                    {canWithdraw && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-600 hover:bg-rose-50"
                        isLoading={withdrawingId === app.id}
                        onClick={() => handleWithdraw(app.id)}
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- 3. Student Profile & Resume Manager ---

const profileSchema = z.object({
  full_name: z.string().min(2, 'Full name is required'),
  university: z.string().min(2, 'University is required'),
  major: z.string().min(2, 'Major is required'),
  graduation_year: z.coerce.number().min(2020).max(2100),
  skills: z.string().optional().or(z.literal('')),
  bio: z.string().optional().or(z.literal('')),
})

export function StudentProfilePage() {
  const [profileLoading, setProfileLoading] = useState(true)
  const [resume, setResume] = useState<any | null>(null)
  const [resumeLoading, setResumeLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
  })

  // Load Profile
  const loadProfile = async () => {
    setProfileLoading(true)
    try {
      const res = await api.get('/profiles/student')
      const data = res.data
      setValue('full_name', data.full_name || '')
      setValue('university', data.university || '')
      setValue('major', data.major || '')
      setValue('graduation_year', data.graduation_year || 2026)
      setValue('skills', data.skills || '')
      setValue('bio', data.bio || '')
    } catch {
      setProfileError('Failed to load profile details.')
    } finally {
      setProfileLoading(false)
    }
  }

  // Load Resume Metadata
  const loadResume = async () => {
    setResumeLoading(true)
    try {
      const res = await api.get('/profiles/student/resume')
      setResume(res.data)
    } catch {
      // 404 means no resume yet
      setResume(null)
    } finally {
      setResumeLoading(false)
    }
  }

  useEffect(() => {
    loadProfile()
    loadResume()
  }, [])

  const onProfileSubmit = async (data: z.infer<typeof profileSchema>) => {
    setProfileError('')
    try {
      await api.put('/profiles/student', data)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } catch {
      setProfileError('Failed to update profile.')
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Verify format and size
    const validExts = ['.pdf', '.doc', '.docx']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!validExts.includes(ext)) {
      alert('Unsupported file format. Please upload PDF, DOC, or DOCX.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('File exceeds 5MB limit.')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post('/profiles/student/resume', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResume(res.data)
    } catch {
      alert('Failed to upload resume. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteResume = async () => {
    if (!resume) return
    if (!confirm('Are you sure you want to delete your uploaded resume?')) return
    try {
      await api.delete(`/profiles/student/resume/${resume.id}`)
      setResume(null)
    } catch {
      alert('Failed to delete resume.')
    }
  }

  const handleDownloadResume = async () => {
    if (!resume) return
    try {
      await downloadAuthenticatedFile(`/profiles/resume/${resume.id}/download`, resume.original_filename || 'resume.pdf')
    } catch {
      alert('Failed to download resume.')
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Student Profile & Documents</h1>
        <p className="text-xs text-slate-500 mt-1">Manage your academic credentials and job application resume.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left 2 Cols: Profile Form */}
        <div className="md:col-span-2">
          <Card className="bg-white">
            <CardHeader>
              <CardTitle>Academic & Personal Details</CardTitle>
              <CardDescription>Employers view these details when reviewing your applications.</CardDescription>
            </CardHeader>
            <CardContent>
              {profileLoading ? (
                <CardSkeleton />
              ) : (
                <form onSubmit={handleSubmit(onProfileSubmit)} className="space-y-3.5">
                  {profileSaved && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700 font-medium">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                      <span>Profile changes saved successfully!</span>
                    </div>
                  )}

                  {profileError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{profileError}</span>
                    </div>
                  )}

                  <Input
                    label="Full Name"
                    error={errors.full_name?.message}
                    {...register('full_name')}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="University"
                      error={errors.university?.message}
                      {...register('university')}
                    />
                    <Input
                      label="Major"
                      error={errors.major?.message}
                      {...register('major')}
                    />
                  </div>

                  <Input
                    label="Graduation Year"
                    type="number"
                    min={2020}
                    max={2100}
                    error={errors.graduation_year?.message}
                    {...register('graduation_year')}
                  />

                  <Input
                    label="Skills"
                    placeholder="Python, React, TypeScript, SQL"
                    helperText="Comma separated list of competencies"
                    error={errors.skills?.message}
                    {...register('skills')}
                  />

                  <Textarea
                    label="Bio / Career Objective"
                    rows={3}
                    error={errors.bio?.message}
                    {...register('bio')}
                  />

                  <div className="pt-2">
                    <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                      Save Profile Changes
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Resume Manager */}
        <div>
          <Card className="bg-white">
            <CardHeader>
              <CardTitle>Resume Document</CardTitle>
              <CardDescription>Upload your latest resume (PDF, DOC, DOCX up to 5MB).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resumeLoading ? (
                <div className="h-24 animate-pulse bg-slate-100 rounded-lg" />
              ) : resume ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {resume.original_filename || 'resume.pdf'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(resume.file_size / 1024).toFixed(1)} KB • {resume.content_type}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={handleDownloadResume}
                      leftIcon={<Download className="w-3.5 h-3.5" />}
                    >
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50 px-2"
                      onClick={handleDeleteResume}
                      title="Delete Resume"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600">No resume uploaded yet</p>
                </div>
              )}

              {/* Upload or Replace button */}
              <div>
                <label className="block">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant={resume ? 'outline' : 'primary'}
                    size="sm"
                    className="w-full text-xs"
                    isLoading={uploading}
                    leftIcon={<Upload className="w-3.5 h-3.5" />}
                    onClick={(e) => {
                      const input = (e.currentTarget.parentElement?.querySelector('input[type=file]') as HTMLInputElement)
                      input?.click()
                    }}
                  >
                    {resume ? 'Replace Resume' : 'Upload Resume'}
                  </Button>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
