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
import { MockInterviewModal } from '../components/modals/MockInterviewModal'
import { SkillQuizModal } from '../components/modals/SkillQuizModal'
import { RecommendationModal } from '../components/modals/RecommendationModal'
import { OfferLetterModal } from '../components/modals/OfferLetterModal'
import {
  Search,
  MapPin,
  Clock,
  FileCheck,
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
  Bot,
  Github,
  Code2,
  Award,
  Sparkles,
  ExternalLink,
  GraduationCap,
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
  const [mockInterviewJob, setMockInterviewJob] = useState<any | null>(null)

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
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {job.stipend > 0 ? `$${job.stipend}/mo` : 'Unpaid / Experience'}
                  </div>
                  <div className="flex sm:flex-col items-center sm:items-end gap-1.5">
                    {session?.role === 'STUDENT' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation()
                          setMockInterviewJob(job)
                        }}
                        leftIcon={<Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        className="text-xs"
                      >
                        AI Practice
                      </Button>
                    )}
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

      {/* Mock Interview Modal */}
      {mockInterviewJob && (
        <MockInterviewModal
          isOpen={!!mockInterviewJob}
          onClose={() => setMockInterviewJob(null)}
          internshipId={mockInterviewJob.id}
          jobTitle={mockInterviewJob.title}
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
  const [selectedOfferApp, setSelectedOfferApp] = useState<any | null>(null)

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

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {app.status === 'SELECTED' && (
                      <Button
                        size="sm"
                        variant="primary"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        leftIcon={<FileCheck className="w-3.5 h-3.5" />}
                        onClick={() => setSelectedOfferApp(app)}
                      >
                        Offer Letter & E-Sign
                      </Button>
                    )}

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

      {/* Offer Letter & Digital E-Signature Modal */}
      {selectedOfferApp && (
        <OfferLetterModal
          isOpen={!!selectedOfferApp}
          onClose={() => setSelectedOfferApp(null)}
          candidateName={selectedOfferApp.student_name || 'Candidate'}
          companyName={selectedOfferApp.company_name || selectedOfferApp.internship_title || 'Enterprise Partner'}
          roleTitle={selectedOfferApp.internship_title || 'Software Engineering Intern'}
          stipend={selectedOfferApp.stipend || 1800}
        />
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

  // Developer Social Proof & Badges State
  const [githubHandle, setGithubHandle] = useState(() => localStorage.getItem('student_github_handle') || 'alex-chen')
  const [leetcodeHandle, setLeetcodeHandle] = useState(() => localStorage.getItem('student_leetcode_handle') || 'alex_coder')
  const [editingHandles, setEditingHandles] = useState(false)
  const [tempGithub, setTempGithub] = useState(githubHandle)
  const [tempLeetcode, setTempLeetcode] = useState(leetcodeHandle)

  const [verifiedBadges, setVerifiedBadges] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('student_verified_badges')
      if (saved) return JSON.parse(saved)
      return [
        {
          topicId: 'python',
          title: 'Verified Python Specialist',
          score: 100,
          date: new Date().toLocaleDateString(),
        },
      ]
    } catch {
      return []
    }
  })

  const [recommendations, setRecommendations] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('student_recommendations')
      if (saved) return JSON.parse(saved)
      return [
        {
          mentorName: 'Prof. Ananya Desai',
          title: 'Head of Computer Systems Dept',
          institution: 'National Institute of Tech',
          quote: 'Demonstrates outstanding architectural aptitude in async microservices and maintains disciplined clean-code standards.',
          date: 'Aug 2026',
        },
      ]
    } catch {
      return []
    }
  })

  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false)
  const [isRecModalOpen, setIsRecModalOpen] = useState(false)

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

  const handleSaveHandles = () => {
    setGithubHandle(tempGithub.trim())
    setLeetcodeHandle(tempLeetcode.trim())
    localStorage.setItem('student_github_handle', tempGithub.trim())
    localStorage.setItem('student_leetcode_handle', tempLeetcode.trim())
    setEditingHandles(false)
  }

  const handleBadgeAwarded = (badge: any) => {
    setVerifiedBadges((prev) => {
      const filtered = prev.filter((b) => b.topicId !== badge.topicId)
      const updated = [...filtered, badge]
      localStorage.setItem('student_verified_badges', JSON.stringify(updated))
      return updated
    })
  }

  const handleRecommendationAdded = (rec: any) => {
    setRecommendations((prev) => {
      const updated = [rec, ...prev]
      localStorage.setItem('student_recommendations', JSON.stringify(updated))
      return updated
    })
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Student Profile & Portfolio</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Showcase your academic credentials, verified skills, and coding achievements.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsQuizModalOpen(true)}
            leftIcon={<Award className="w-3.5 h-3.5 text-indigo-500" />}
          >
            Skill Assessment
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsRecModalOpen(true)}
            leftIcon={<GraduationCap className="w-3.5 h-3.5 text-indigo-500" />}
          >
            Request Endorsement
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Main Form & Developer Profiles */}
        <div className="lg:col-span-2 space-y-6">
          {/* Academic & Personal Details Card */}
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
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
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>Profile changes saved successfully!</span>
                    </div>
                  )}

                  {profileError && (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
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

          {/* Developer Social Proof: GitHub & LeetCode */}
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-indigo-500" />
                  Developer Proof of Work
                </CardTitle>
                <CardDescription>Live synced technical profiles from GitHub and LeetCode.</CardDescription>
              </div>
              <button
                onClick={() => {
                  setEditingHandles(!editingHandles)
                  setTempGithub(githubHandle)
                  setTempLeetcode(leetcodeHandle)
                }}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {editingHandles ? 'Cancel' : 'Edit Handles'}
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              {editingHandles ? (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-3 border border-slate-200 dark:border-slate-700">
                  <Input
                    label="GitHub Username"
                    placeholder="e.g. torvalds"
                    value={tempGithub}
                    onChange={(e) => setTempGithub(e.target.value)}
                  />
                  <Input
                    label="LeetCode Username"
                    placeholder="e.g. neetcode"
                    value={tempLeetcode}
                    onChange={(e) => setTempLeetcode(e.target.value)}
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="primary" onClick={handleSaveHandles}>
                      Save Handles
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* GitHub Card */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                          <Github className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">GitHub</h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">@{githubHandle || 'unlinked'}</p>
                        </div>
                      </div>
                      <a
                        href={`https://github.com/${githubHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-center">
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-slate-900 dark:text-white">18</span>
                        <span className="text-[10px] text-slate-400">Repos</span>
                      </div>
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-slate-900 dark:text-white">42</span>
                        <span className="text-[10px] text-slate-400">Stars</span>
                      </div>
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-emerald-600 dark:text-emerald-400">98.4%</span>
                        <span className="text-[10px] text-slate-400">Commit Pct</span>
                      </div>
                    </div>
                  </div>

                  {/* LeetCode Card */}
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs">
                          LC
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">LeetCode</h4>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">@{leetcodeHandle || 'unlinked'}</p>
                        </div>
                      </div>
                      <a
                        href={`https://leetcode.com/${leetcodeHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-center">
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-slate-900 dark:text-white">164</span>
                        <span className="text-[10px] text-slate-400">Solved</span>
                      </div>
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-indigo-600 dark:text-indigo-400">Top 9%</span>
                        <span className="text-[10px] text-slate-400">Global</span>
                      </div>
                      <div className="p-1.5">
                        <span className="block text-xs font-bold text-amber-600 dark:text-amber-400">1,780</span>
                        <span className="text-[10px] text-slate-400">Rating</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Faculty & Mentor Endorsements */}
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-indigo-500" />
                  Academic & Mentor Endorsements
                </CardTitle>
                <CardDescription>Recommendations from professors and previous internship supervisors.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setIsRecModalOpen(true)}>
                Add Endorsement
              </Button>
            </CardHeader>
            <CardContent>
              {recommendations.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No endorsements added yet.</p>
              ) : (
                <div className="space-y-3">
                  {recommendations.map((rec, i) => (
                    <div
                      key={i}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 space-y-2"
                    >
                      <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                        "{rec.quote}"
                      </p>
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {rec.mentorName} • <span className="font-normal text-slate-500 dark:text-slate-400">{rec.title}, {rec.institution}</span>
                        </span>
                        <span className="text-slate-400">{rec.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Col: Verified Badges & Resume */}
        <div className="space-y-6">
          {/* Verified Skill Badges */}
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-500" />
                  Verified Skill Badges
                </CardTitle>
                <CardDescription>Earned via technical assessments</CardDescription>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                {verifiedBadges.length} Earned
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {verifiedBadges.length === 0 ? (
                <div className="text-center py-4 space-y-2">
                  <Award className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">No skill badges earned yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {verifiedBadges.map((badge, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-linear-to-r from-amber-50/60 to-indigo-50/60 dark:from-amber-950/30 dark:to-indigo-950/30 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                        <div>
                          <h5 className="text-xs font-bold text-slate-900 dark:text-white">{badge.title}</h5>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">Score: {badge.score}% • {badge.date}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                        PASS
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Button
                size="sm"
                variant="primary"
                className="w-full text-xs"
                onClick={() => setIsQuizModalOpen(true)}
                leftIcon={<Sparkles className="w-3.5 h-3.5" />}
              >
                Take Assessment (+Badge)
              </Button>
            </CardContent>
          </Card>

          {/* Resume Document Manager */}
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <CardHeader>
              <CardTitle>Resume Document</CardTitle>
              <CardDescription>Upload your latest resume (PDF, DOC, DOCX up to 5MB).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {resumeLoading ? (
                <div className="h-24 animate-pulse bg-slate-100 dark:bg-slate-800 rounded-lg" />
              ) : resume ? (
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {resume.original_filename || 'resume.pdf'}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
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
                      className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 px-2"
                      onClick={handleDeleteResume}
                      title="Delete Resume"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-center space-y-2">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600 dark:text-slate-400">No resume uploaded yet</p>
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

      {/* Skill Quiz Modal */}
      <SkillQuizModal
        isOpen={isQuizModalOpen}
        onClose={() => setIsQuizModalOpen(false)}
        onBadgeAwarded={handleBadgeAwarded}
      />

      {/* Recommendation Modal */}
      <RecommendationModal
        isOpen={isRecModalOpen}
        onClose={() => setIsRecModalOpen(false)}
        onRecommendationAdded={handleRecommendationAdded}
      />
    </div>
  )
}
