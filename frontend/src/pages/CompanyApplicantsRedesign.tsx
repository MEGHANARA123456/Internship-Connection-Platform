import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BriefcaseBusiness,
  ChevronDown,
  Clock3,
  FileText,
  Loader2,
  X,
} from 'lucide-react'
import { api, downloadAuthenticatedFile } from '../api/client'
import { CandidateActions } from '../components/company/CandidateActions'
import { ScheduleInterviewModal } from '../components/modals/ScheduleInterviewModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ErrorState } from '../components/ui/ErrorState'
import { Modal } from '../components/ui/Modal'
import { TableSkeleton } from '../components/ui/LoadingSkeleton'
import { Textarea } from '../components/ui/Textarea'
import { DropdownSelect } from '../components/ui/DropdownSelect'
import { SearchBox } from '../components/ui/SearchBox'
import { showToast } from '../lib/feedback'
import { confirmAction } from '../lib/feedback'
import { invalidateCompanyMetrics } from '../hooks/useCompanyMetrics'

interface CompanyApplicant {
  id: number
  internship_id: number
  internship_title: string | null
  student_id: number
  student_name: string | null
  student_university: string | null
  student_skills: string[]
  status: string
  display_status?: string
  allowed_next: string[]
  allowed_actions: string[]
  created_at: string
  resume_id: number | null
  has_resume?: boolean
  resume_filename?: string | null
  resume_size?: number | null
  match_score: number | null
  match_explanation?: string | null
  verified_badges?: Array<{ id: number; topic: string; title: string; level: string; score: number; expires_at: string }>
  cover_note?: string | null
}

interface CompanyInternship {
  id: number
  title: string
  location?: string | null
  status?: string
  created_at?: string
  applicant_count?: number
}

interface CandidateFiltersProps {
  search: string
  setSearch: (value: string) => void
  internshipId: string
  skills: string
  setSkills: (value: string) => void
  education: string
  setEducation: (value: string) => void
  applicantFilter: string
  setApplicantFilter: (value: string) => void
  sort: string
  setSort: (value: string) => void
  internships: CompanyInternship[]
  updateFilter: (key: string, value: string) => void
  applyFilters: () => void
  resetFilters: () => void
}

function CandidateFilters({
  search,
  setSearch,
  internshipId,
  skills,
  setSkills,
  education,
  setEducation,
  sort,
  setSort,
  internships,
  updateFilter,
  applicantFilter,
  setApplicantFilter,
  applyFilters,
  resetFilters,
}: CandidateFiltersProps) {
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') applyFilters()
  }

  return (
    <div
      role="group"
      aria-label="Candidate filters"
      className="glass-strong grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(160px,1fr)_auto]"
    >
      <SearchBox
        ariaLabel="Search candidate"
        value={search}
        onChange={setSearch}
        onSubmit={applyFilters}
        scope="applicants"
        placeholder="Search candidate"
        className="min-w-0"
      />
      <div className="min-w-0">
        <DropdownSelect
          aria-label="Filter by internship"
          value={internshipId}
          onChange={(value) => updateFilter('internship', value)}
          options={[
            { label: 'All internships', value: '' },
            ...internshipOptions(internships),
          ]}
        />
      </div>
      <label className="min-w-0">
        <span className="sr-only">Filter by skills</span>
        <input
          aria-label="Filter by skills"
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder="Skills"
          className="glass-input h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </label>
      <label className="min-w-0">
        <span className="sr-only">Filter by education</span>
        <input
          aria-label="Filter by education"
          value={education}
          onChange={(event) => setEducation(event.target.value)}
          onKeyDown={submitOnEnter}
          placeholder="Education"
          className="glass-input h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      </label>
      <div className="min-w-0">
        <DropdownSelect
          aria-label="Filter by verified skill"
          value={applicantFilter}
          onChange={(value) => {
            setApplicantFilter(value)
          }}
          options={[
            { label: 'All applicants', value: '' },
            { label: 'Verified skill', value: 'verified_skill' },
            { label: 'Shortlisted', value: 'shortlisted' },
            { label: 'High match (70%+)', value: 'high_match' },
            { label: 'Not reviewed (Applied)', value: 'not_reviewed' },
          ]}
        />
      </div>
      <div className="min-w-0 xl:min-w-[160px]">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">Sort by</span>
        <DropdownSelect
          aria-label="Sort candidates"
          value={sort}
          onChange={setSort}
          options={[
            { label: 'Newest', value: 'newest' },
            { label: 'Oldest', value: 'oldest' },
            { label: 'Best match', value: 'best_match' },
            { label: 'Name A-Z', value: 'name' },
          ]}
        />
      </div>
      <div className="flex h-10 min-w-0 items-center gap-2 lg:col-span-2 2xl:col-span-1">
        <Button size="md" variant="primary" className="h-10 min-w-0 flex-1" onClick={applyFilters}>Apply</Button>
        <Button size="md" variant="ghost" className="h-10 min-w-0 flex-1" onClick={resetFilters}>Clear filters</Button>
      </div>
    </div>
  )
}

function internshipOptions(internships: CompanyInternship[]) {
  const options = internships.map((internship) => {
    const posted = internship.created_at
      ? new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(internship.created_at))
      : internship.status?.replaceAll('_', ' ').toLowerCase()
    const count = internship.applicant_count ?? 0
    const label = [
      internship.title,
      internship.location?.trim() || 'Location not set',
      posted,
    ].filter(Boolean).join(' · ')
    return {
      id: internship.id,
      label: `${label} (${count})`,
      value: String(internship.id),
    }
  })
  const labelCounts = new Map<string, number>()
  for (const option of options) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)
  }
  return options.map((option) => ({
    label: labelCounts.get(option.label)! > 1 ? `${option.label} · #${option.id}` : option.label,
    value: option.value,
  }))
}

const stages = [
  { key: 'APPLIED', label: 'Applied', color: 'border-t-blue-500' },
  { key: 'UNDER_REVIEW', label: 'Under Review', color: 'border-t-amber-500' },
  { key: 'SHORTLISTED', label: 'Shortlisted', color: 'border-t-purple-500' },
  { key: 'INTERVIEW_SCHEDULED', label: 'Interview', color: 'border-t-cyan-500' },
  { key: 'SELECTED', label: 'Selected', color: 'border-t-emerald-500' },
  { key: 'ACCEPTED', label: 'Accepted', color: 'border-t-green-700' },
  { key: 'REJECTED', label: 'Rejected', color: 'border-t-rose-500' },
]

function initials(name: string | null) {
  return (name || 'Candidate').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function parseAppliedAt(createdAt: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(createdAt)
  return new Date(hasTimezone ? createdAt : `${createdAt}Z`)
}

function relativeAppliedTime(createdAt: string) {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.max(0, Math.round(
    (startOfDay(new Date()) - startOfDay(parseAppliedAt(createdAt))) / 86_400_000,
  ))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function appliedDate(createdAt: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parseAppliedAt(createdAt))
}

function matchTone(score: number | null) {
  if (score === null) return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  if (score >= 70) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
  if (score >= 50) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
}

function CandidateAvatar({ name }: { name: string | null }) {
  return <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{initials(name)}</span>
}

function ApplicantCard({
  item,
  saving,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onSelect,
  onSchedule,
  onReview,
  onNotes,
}: {
  item: CompanyApplicant
  saving: boolean
  dragging: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onMove: (status: string, skipConfirmation?: boolean) => void
  onSelect: () => void
  onSchedule: () => void
  onReview: () => void
  onNotes: () => void
}) {
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`glass-static relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-opacity dark:border-slate-700 dark:bg-slate-900 ${dragging ? 'opacity-40' : ''}`}
      aria-label={`${item.student_name || 'Candidate'} application`}
    >
      {saving && <span role="status" aria-label="Saving status" className="absolute right-2 top-2"><Loader2 className="h-4 w-4 animate-spin text-indigo-600" /></span>}
      <div className="flex items-start gap-2.5">
        <CandidateAvatar name={item.student_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate pr-5 text-sm font-semibold text-slate-900 dark:text-white">{item.student_name || 'Candidate'}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-slate-700 dark:text-slate-300" title={item.internship_title || 'Internship'}>{item.internship_title || 'Internship'}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{item.student_university || 'Education not provided'}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span title={item.match_explanation || undefined} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${matchTone(item.match_score)}`}>{item.match_score == null ? 'No match score' : `${Math.round(item.match_score)}% match`}</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">Applied {relativeAppliedTime(item.created_at)}</span>
      </div>
      {item.student_skills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.student_skills.slice(0, 5).map((skill) => <span key={skill} className="max-w-24 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={skill}>{skill}</span>)}
          {item.student_skills.length > 5 && <span title={item.student_skills.join(', ')} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{item.student_skills.length - 5} more</span>}
        </div>
      )}
      {item.verified_badges && item.verified_badges.length > 0 && (
        <div aria-label="Verified skills" className="mt-2 flex flex-wrap gap-1">
          {item.verified_badges.map((badge) => (
            <span key={badge.id} title={`${badge.title} · ${badge.level} · expires ${new Date(badge.expires_at).toLocaleDateString()}`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
              Verified skill: {badge.topic}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
        <div className="min-w-0">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{item.status.replaceAll('_', ' ')}</span>
          {item.display_status === 'EXPIRED' && <p className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">Interview completed. Update the status</p>}
        </div>
        <CandidateActions
          item={item}
          onReview={onReview}
          onNotes={onNotes}
          onMoveToReview={() => onMove('UNDER_REVIEW')}
          onShortlist={() => onMove('SHORTLISTED')}
          onSchedule={onSchedule}
          onSelect={onSelect}
          onReject={() => onMove('REJECTED', true)}
          disabled={saving}
        />
      </div>
    </article>
  )
}

export function CompanyApplicantsRedesign({
  pipeline,
  view = 'shortlisted',
}: {
  pipeline: boolean
  view?: 'applicants' | 'shortlisted'
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState<CompanyApplicant[]>([])
  const [total, setTotal] = useState(0)
  const [internships, setInternships] = useState<CompanyInternship[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [downloadingResumeId, setDownloadingResumeId] = useState<number | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [activeInterview, setActiveInterview] = useState<CompanyApplicant | null>(null)
  const [notesApplicant, setNotesApplicant] = useState<CompanyApplicant | null>(null)
  const [reviewApplicant, setReviewApplicant] = useState<CompanyApplicant | null>(null)
  const [applicationNotes, setApplicationNotes] = useState<Array<{ id: number; body: string; created_at: string }>>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [noteError, setNoteError] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [skills, setSkills] = useState(searchParams.get('skills') ?? '')
  const [education, setEducation] = useState(searchParams.get('education') ?? '')
  const [sort, setSort] = useState(searchParams.get('sort') ?? 'newest')
  const [mobileStage, setMobileStage] = useState('APPLIED')
  const [rejectedExpanded, setRejectedExpanded] = useState(false)
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1)
  const queryString = searchParams.toString()
  const applicantFilter = searchParams.get('applicant_filter')
    || (searchParams.get('verified_skill') === 'true' ? 'verified_skill' : '')

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = Object.fromEntries(new URLSearchParams(queryString).entries())
      if (pipeline) {
        params.page = '1'
        params.page_size = '100'
      } else {
        if (view === 'shortlisted') params.status = 'SHORTLISTED'
        else delete params.status
        params.page = String(page)
        params.page_size = '20'
      }
      const firstResponse = await api.get('/applications/company/search', { params })
      const firstData = firstResponse.data
      let loadedItems: CompanyApplicant[] = firstData?.items ?? []
      if (pipeline && loadedItems.length < (firstData?.total ?? 0)) {
        const pages = Math.ceil(firstData.total / 100)
        const laterPages = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => api.get('/applications/company/search', { params: { ...params, page: index + 2 } })))
        loadedItems = [...loadedItems, ...laterPages.flatMap((response) => response.data?.items ?? [])]
      }
      setItems(loadedItems)
      setTotal(firstData?.total ?? 0)
    } catch (requestError) {
      console.error('Unable to load company applicants.', requestError)
      setError('Could not load applicants for this company.')
    } finally {
      setLoading(false)
    }
  }, [page, pipeline, queryString, view])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const params = new URLSearchParams(queryString)
    setSearch(params.get('search') ?? '')
    setSkills(params.get('skills') ?? '')
    setEducation(params.get('education') ?? '')
    setSort(params.get('sort') ?? 'newest')
  }, [queryString])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      for (const [key, value] of [['search', search], ['skills', skills], ['education', education]]) {
        if (value.trim()) next.set(key, value.trim())
        else next.delete(key)
      }
      next.delete('page')
      if (next.toString() !== queryString) {
        setSearchParams(next, { replace: true })
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [education, queryString, search, searchParams, setSearchParams, skills])
  useEffect(() => {
    api.get('/internships/mine')
      .then(({ data }) => setInternships(data ?? []))
      .catch((requestError: unknown) => {
        console.error('Unable to load company internships for applicant filters.', requestError)
        notify('Could not load your internships for filtering.')
      })
  }, [])

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'ALL') next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setSearchParams(next)
  }

  const updateApplicantFilter = (value: string) => {
    const next = new URLSearchParams(searchParams)
    next.delete('applicant_filter')
    next.delete('verified_skill')
    if (value === 'verified_skill') next.set('verified_skill', 'true')
    else if (value) next.set('applicant_filter', value)
    next.delete('page')
    setSearchParams(next)
  }

  const applyFilters = () => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of [['search', search], ['skills', skills], ['education', education], ['sort', sort]]) {
      if (value.trim()) next.set(key, value.trim())
      else next.delete(key)
    }
    next.delete('page')
    setSearchParams(next)
  }

  const resetFilters = () => {
    setSearch('')
    setSkills('')
    setEducation('')
    setSort('newest')
    setSearchParams(pipeline || view === 'applicants' ? new URLSearchParams() : new URLSearchParams({ status: 'SHORTLISTED' }))
  }

  const moveApplicant = async (item: CompanyApplicant, nextStatus: string, skipConfirmation = false) => {
    if (!item.allowed_next.includes(nextStatus) || item.status === nextStatus) return
    if (!skipConfirmation && nextStatus === 'REJECTED' && !await confirmAction({
      title: 'Reject applicant?',
      message: `Reject ${item.student_name || 'Candidate'}? They will be notified.`,
      confirmLabel: 'Reject applicant',
      destructive: true,
    })) return
    if (!skipConfirmation && nextStatus === 'SELECTED' && !await confirmAction({
      title: 'Confirm offer?',
      message: `Confirm the offer for ${item.student_name || 'Candidate'}?`,
      confirmLabel: 'Confirm offer',
    })) return
    setProcessingId(item.id)
    const originalItems = items
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: nextStatus } : entry))
    try {
      await api.patch(`/applications/${item.id}/status`, { status: nextStatus })
      invalidateCompanyMetrics()
      await load()
    } catch (requestError) {
      console.error(`Unable to move applicant ${item.id} to ${nextStatus}.`, requestError)
      setItems(originalItems)
      notify('That status change failed. The candidate was returned to the previous stage.')
    } finally {
      setProcessingId(null)
    }
  }

  const downloadResume = async (item: CompanyApplicant) => {
    if (!item.has_resume && !item.resume_id || !item.resume_id) {
      showToast('Resume not uploaded by the student', 'error')
      return
    }
    setDownloadingResumeId(item.id)
    try {
      const filename = await downloadAuthenticatedFile(`/profiles/resume/${item.resume_id}/download`, item.resume_filename || `resume_candidate_${item.student_id}.pdf`)
      showToast(`Resume downloaded: ${filename}`, 'success')
    } catch (requestError) {
      console.error(`Unable to download resume for applicant ${item.id}.`, requestError)
      const status = (requestError as any)?.response?.status
      showToast(status === 404
        ? 'Resume not uploaded by the student'
        : status === 403
          ? "You don't have access to this resume"
          : "Couldn't download the resume, please try again", 'error')
    } finally {
      setDownloadingResumeId(null)
    }
  }

  const openNotes = async (item: CompanyApplicant) => {
    setNotesApplicant(item)
    setNoteDraft('')
    setNoteError('')
    try {
      const response = await api.get(`/applications/${item.id}/notes`)
      setApplicationNotes(response.data ?? [])
    } catch (requestError) {
      console.error(`Unable to load notes for applicant ${item.id}.`, requestError)
      setApplicationNotes([])
      setNoteError('Could not load private recruiter notes.')
    }
  }

  const saveNote = async () => {
    if (!notesApplicant || !noteDraft.trim()) return
    setSavingNote(true)
    setNoteError('')
    try {
      const response = await api.post(`/applications/${notesApplicant.id}/notes`, { body: noteDraft.trim() })
      setApplicationNotes((current) => [...current, response.data])
      setNoteDraft('')
    } catch (requestError) {
      console.error(`Unable to save notes for applicant ${notesApplicant.id}.`, requestError)
      setNoteError('Could not save this private note. Please retry.')
    } finally {
      setSavingNote(false)
    }
  }

  const handleDragStart = (event: DragEvent<HTMLDivElement>, item: CompanyApplicant) => {
    event.dataTransfer.setData('text/plain', String(item.id))
    event.dataTransfer.effectAllowed = 'move'
    setDraggedId(item.id)
  }

  const handleDrop = (event: DragEvent<HTMLElement>, target: string) => {
    event.preventDefault()
    const id = Number(event.dataTransfer.getData('text/plain'))
    setDraggedId(null)
    const item = items.find((entry) => entry.id === id)
    if (item?.allowed_next.includes(target)) void moveApplicant(item, target)
  }

  const groups = stages.map((stage) => ({
    ...stage,
    items: items.filter((item) => item.status === stage.key),
  }))
  const activeFilterChips: Array<{ key: string; label: string }> = []
  const selectedInternshipId = searchParams.get('internship')
  const selectedInternship = internships.find((internship) => String(internship.id) === selectedInternshipId)
  const applicantFilterLabels: Record<string, string> = {
    verified_skill: 'Verified skill',
    shortlisted: 'Shortlisted',
    high_match: 'High match (70%+)',
    not_reviewed: 'Not reviewed (Applied)',
  }
  if (searchParams.get('search')) activeFilterChips.push({ key: 'search', label: `Search: ${searchParams.get('search')}` })
  if (selectedInternshipId) activeFilterChips.push({
    key: 'internship',
    label: `Internship: ${selectedInternship?.title ?? `#${selectedInternshipId}`}`,
  })
  if (applicantFilter) activeFilterChips.push({
    key: 'applicant_filter',
    label: applicantFilterLabels[applicantFilter] ?? 'Verified skill',
  })
  if (searchParams.get('skills')) activeFilterChips.push({ key: 'skills', label: `Skills: ${searchParams.get('skills')}` })
  if (searchParams.get('education')) activeFilterChips.push({ key: 'education', label: `Education: ${searchParams.get('education')}` })
  if (searchParams.get('sort') && searchParams.get('sort') !== 'newest') {
    const sortLabel = searchParams.get('sort') === 'best_match'
      ? 'Best match'
      : searchParams.get('sort') === 'oldest'
        ? 'Oldest'
        : 'Name A-Z'
    activeFilterChips.push({ key: 'sort', label: `Sort: ${sortLabel}` })
  }
  const candidateActions = (item: CompanyApplicant, variant: 'stacked' | 'icons') => (
    <CandidateActions
      item={item}
      variant={variant}
      onSchedule={() => setActiveInterview(item)}
      onReview={() => setReviewApplicant(item)}
      onNotes={() => void openNotes(item)}
      onMoveToReview={() => void moveApplicant(item, 'UNDER_REVIEW')}
      onShortlist={() => void moveApplicant(item, 'SHORTLISTED')}
      onSelect={() => void moveApplicant(item, 'SELECTED', true)}
      onReject={() => void moveApplicant(item, 'REJECTED', true)}
      disabled={processingId === item.id}
    />
  )

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 px-1 py-2 sm:px-2">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{pipeline ? 'Hiring pipeline' : view === 'shortlisted' ? 'Shortlisted candidates' : 'Applicants'}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{total.toLocaleString()} candidates across your internships</p>
        </div>
        {pipeline ? (
          <Card className="glass-strong grid w-full gap-2 bg-white p-3 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4 xl:max-w-6xl">
            <SearchBox
              ariaLabel="Search candidate"
              value={search}
              onChange={setSearch}
              onSubmit={applyFilters}
              scope="applicants"
              placeholder="Search candidates"
            />
            <DropdownSelect aria-label="Filter by internship" value={selectedInternshipId ?? ''} onChange={(value) => updateFilter('internship', value)} options={[{ label: 'All internships', value: '' }, ...internshipOptions(internships)]} />
            <DropdownSelect aria-label="Filter by verified skill" value={applicantFilter} onChange={updateApplicantFilter} options={[
              { label: 'All applicants', value: '' },
              { label: 'Verified skill', value: 'verified_skill' },
              { label: 'Shortlisted', value: 'shortlisted' },
              { label: 'High match (70%+)', value: 'high_match' },
              { label: 'Not reviewed (Applied)', value: 'not_reviewed' },
            ]} />
            <DropdownSelect aria-label="Sort candidates" value={sort} onChange={(value) => { setSort(value); updateFilter('sort', value) }} options={[{ label: 'Best match', value: 'best_match' }, { label: 'Newest', value: 'newest' }, { label: 'Oldest', value: 'oldest' }, { label: 'Name A-Z', value: 'name' }]} />
            <input aria-label="Filter by skills" value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Skills" className="glass-input h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <input aria-label="Filter by education" value={education} onChange={(event) => setEducation(event.target.value)} placeholder="Education" className="glass-input h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <div className="flex items-center gap-2 lg:col-span-2">
              <Button size="md" variant="primary" className="h-10 flex-1" onClick={applyFilters}>Apply</Button>
              <Button size="md" variant="ghost" className="h-10 flex-1" onClick={resetFilters}>Clear filters</Button>
            </div>
          </Card>
        ) : (
          <CandidateFilters
            search={search}
            setSearch={setSearch}
            internshipId={searchParams.get('internship') ?? ''}
            skills={skills}
            setSkills={setSkills}
            education={education}
            setEducation={setEducation}
            applicantFilter={applicantFilter}
            setApplicantFilter={updateApplicantFilter}
            sort={sort}
            setSort={setSort}
            internships={internships}
            updateFilter={updateFilter}
            applyFilters={applyFilters}
            resetFilters={resetFilters}
          />
        )}
      </header>

      {pipeline && activeFilterChips.length > 0 && (
        <div aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => chip.key === 'applicant_filter'
                ? updateApplicantFilter('')
                : updateFilter(chip.key, '')}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-900"
            >
              {chip.label}<X className="h-3 w-3" aria-hidden="true" />
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={resetFilters}>Clear filters</Button>
        </div>
      )}

      {!pipeline && <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button></div>}
      {pipeline ? (
        error ? <ErrorState message={error} onRetry={() => void load()} /> : !loading && items.length === 0 ? (
          <div className="glass-static rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <BriefcaseBusiness className="mx-auto h-8 w-8 text-slate-400" />
            <h2 className="mt-3 font-semibold text-slate-900 dark:text-white">No candidates match these filters</h2>
            <Button className="mt-4" variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button>
          </div>
        ) : (
          <>
            <nav aria-label="Pipeline stages" className="flex gap-2 overflow-x-auto pb-1 md:hidden">
              {stages.map((stage) => <button key={stage.key} type="button" onClick={() => setMobileStage(stage.key)} aria-pressed={mobileStage === stage.key} className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold ${mobileStage === stage.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{stage.label} <span className="ml-1 rounded-full bg-black/10 px-1.5 py-0.5 dark:bg-white/10">{groups.find((group) => group.key === stage.key)?.items.length ?? 0}</span></button>)}
            </nav>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
              {groups.map((group) => {
                const visibleOnMobile = mobileStage === group.key
                const validTarget = draggedId !== null && items.find((item) => item.id === draggedId)?.allowed_next.includes(group.key)
                const rejected = group.key === 'REJECTED'
                return (
                  <section
                    key={group.key}
                    aria-label={`${group.label} applicants`}
                    onDragOver={(event) => { if (validTarget) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
                    onDrop={(event) => handleDrop(event, group.key)}
                    className={`glass-static w-full shrink-0 snap-start rounded-xl border border-t-4 ${group.color} border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/60 md:w-[300px] ${visibleOnMobile ? 'block' : 'hidden md:block'} ${draggedId !== null && !validTarget ? 'opacity-40' : ''} ${validTarget ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-950' : ''}`}
                  >
                    <header className="sticky top-0 z-10 flex items-center justify-between rounded-t-lg border-b border-slate-200 bg-slate-50/95 px-3 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
                      {rejected ? <button type="button" aria-expanded={rejectedExpanded} onClick={() => setRejectedExpanded((value) => !value)} className="flex w-full items-center justify-between text-sm font-bold text-slate-800 dark:text-slate-200">{group.label}<span className="flex items-center gap-2"><Badge variant="slate">{group.items.length}</Badge><ChevronDown className={`h-4 w-4 transition-transform ${rejectedExpanded ? 'rotate-180' : ''}`} /></span></button> : <h2 className="flex w-full items-center justify-between text-sm font-bold text-slate-800 dark:text-slate-200">{group.label}<Badge variant="slate">{group.items.length}</Badge></h2>}
                    </header>
                    {(!rejected || rejectedExpanded) && (
                      <div className="max-h-[calc(100dvh-19rem)] min-h-36 space-y-2 overflow-y-auto p-2.5">
                        {loading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="glass-static h-36 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" />) : group.items.length === 0 ? <div className="glass-static flex min-h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">No candidates here yet</div> : group.items.map((item) => (
                          <ApplicantCard
                            key={item.id}
                            item={item}
                            saving={processingId === item.id}
                            dragging={draggedId === item.id}
                            onDragStart={(event) => handleDragStart(event, item)}
                            onDragEnd={() => setDraggedId(null)}
                            onMove={(nextStatus, skipConfirmation) => void moveApplicant(item, nextStatus, skipConfirmation)}
                            onSelect={() => void moveApplicant(item, 'SELECTED', true)}
                            onSchedule={() => setActiveInterview(item)}
                            onReview={() => setReviewApplicant(item)}
                            onNotes={() => void openNotes(item)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </>
        )
      ) : (
        <>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : loading ? <TableSkeleton rows={6} /> : items.length === 0 ? (
            <div className="glass-static rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <BriefcaseBusiness className="mx-auto h-8 w-8 text-slate-400" />
              <h2 className="mt-3 font-semibold text-slate-900 dark:text-white">{view === 'shortlisted' ? 'No shortlisted candidates' : 'No applicants'}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No candidates match the current filters.</p>
            </div>
          ) : (
            <>
              <div className="glass-strong hidden max-h-[calc(100dvh-18rem)] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 md:block">
                <table className="w-full min-w-[1050px] bg-transparent text-left text-sm dark:bg-slate-900">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Internship</th><th className="px-4 py-3">Skills / match</th><th className="px-4 py-3">Applied</th><th className="px-4 py-3">Status</th><th className="w-[190px] px-4 py-3">Actions</th></tr></thead>
                  <tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><CandidateAvatar name={item.student_name} /><div className="min-w-0"><strong className="block truncate">{item.student_name || 'Candidate'}</strong><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.student_university || 'Education not provided'}</span></div></div></td>
                    <td className="max-w-48 px-4 py-3"><p className="line-clamp-2" title={item.internship_title || 'Internship'}>{item.internship_title || 'Internship'}</p></td>
                    <td className="max-w-64 px-4 py-3"><div className="flex flex-wrap gap-1">{item.student_skills.slice(0, 5).map((skill) => <span key={skill} title={skill} className="max-w-24 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{skill}</span>)}{item.student_skills.length > 5 && <span title={item.student_skills.join(', ')} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">+{item.student_skills.length - 5} more</span>}{item.student_skills.length === 0 && <span className="text-xs text-slate-400">—</span>}</div>{item.match_score != null && <div className="mt-2 max-w-40"><div className="mb-1 flex items-center justify-between"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${matchTone(item.match_score)}`}>{Math.round(item.match_score)}% match</span><span className="sr-only">Match score</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className={`h-full ${item.match_score >= 70 ? 'bg-emerald-500' : item.match_score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, Math.max(0, item.match_score))}%` }} /></div></div>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs"><span className="flex items-center gap-1 text-slate-700 dark:text-slate-300"><Clock3 className="h-3 w-3" />{relativeAppliedTime(item.created_at)}</span><time className="mt-1 block text-slate-500" dateTime={item.created_at}>{appliedDate(item.created_at)}</time></td>
                    <td className="px-4 py-3"><Badge status={item.display_status || item.status}>{item.display_status === 'EXPIRED' ? 'Expired' : item.status.replaceAll('_', ' ')}</Badge>{item.display_status === 'EXPIRED' && <p className="mt-1 max-w-36 text-xs text-amber-700 dark:text-amber-300">Interview completed. Update the status</p>}</td>
                    <td className="w-[190px] px-3 py-2">{candidateActions(item, 'stacked')}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.id} className="glass-static rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start gap-2"><CandidateAvatar name={item.student_name} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.student_name || 'Candidate'}</p><p className="truncate text-xs text-slate-500">{item.student_university || 'Education not provided'}</p><p className="mt-2 line-clamp-2 text-sm" title={item.internship_title || 'Internship'}>{item.internship_title || 'Internship'}</p></div><Badge status={item.display_status || item.status}>{item.display_status === 'EXPIRED' ? 'Expired' : item.status.replaceAll('_', ' ')}</Badge></div>
                {item.display_status === 'EXPIRED' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Interview completed. Update the status</p>}
                <div className="mt-3 flex flex-wrap gap-1">{item.student_skills.slice(0, 6).map((skill) => <span key={skill} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] dark:bg-slate-800">{skill}</span>)}{item.student_skills.length > 6 && <span title={item.student_skills.join(', ')} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] dark:bg-slate-800">+{item.student_skills.length - 6} more</span>}</div>
                {item.match_score != null && <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${matchTone(item.match_score)}`}>{Math.round(item.match_score)}% match</span>}
                <p className="mt-2 text-xs text-slate-500">Applied {relativeAppliedTime(item.created_at)} · {appliedDate(item.created_at)}</p>
                <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">{candidateActions(item, 'stacked')}</div>
              </article>)}</div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / 20))}</p>
                <div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => updateFilter('page', String(page - 1))}>Previous</Button><Button variant="outline" disabled={page * 20 >= total} onClick={() => updateFilter('page', String(page + 1))}>Next</Button></div>
              </div>
            </>
          )}
        </>
      )}

      {toast && <div role="status" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><X className="h-4 w-4" /></button></div>}
      {activeInterview && <ScheduleInterviewModal isOpen onClose={() => setActiveInterview(null)} applicationId={activeInterview.id} candidateName={activeInterview.student_name ?? undefined} jobTitle={activeInterview.internship_title ?? undefined} onScheduled={() => { setActiveInterview(null); invalidateCompanyMetrics(); void load() }} />}
      <Modal isOpen={notesApplicant !== null} onClose={() => setNotesApplicant(null)} title="Private recruiter notes" description={`${notesApplicant?.student_name || 'Candidate'} · only visible to your company`}>
        <div className="space-y-3">
          {noteError && <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{noteError}</p>}
          <ul className="max-h-48 space-y-2 overflow-y-auto">{applicationNotes.map((note) => <li key={note.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><p className="whitespace-pre-wrap">{note.body}</p><time className="mt-2 block text-[10px] text-slate-500">{new Date(note.created_at).toLocaleString()}</time></li>)}</ul>
          <Textarea label="Add a private note" rows={3} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={5000} />
          <div className="flex justify-end"><Button type="button" onClick={() => void saveNote()} disabled={!noteDraft.trim() || savingNote} isLoading={savingNote}>Save note</Button></div>
        </div>
      </Modal>
      <Modal isOpen={reviewApplicant !== null} onClose={() => setReviewApplicant(null)} title="Candidate review" description={reviewApplicant?.internship_title || undefined}>
        {reviewApplicant && <div className="space-y-3 text-sm"><div className="flex items-center gap-3"><CandidateAvatar name={reviewApplicant.student_name} /><div><p className="font-semibold">{reviewApplicant.student_name || 'Candidate'}</p><p className="text-xs text-slate-500">{reviewApplicant.student_university || 'Education not provided'}</p></div></div><p><span className="font-semibold">Skills:</span> {reviewApplicant.student_skills.join(', ') || 'Not provided'}</p><p className="whitespace-pre-wrap"><span className="font-semibold">Cover note:</span> {reviewApplicant.cover_note || 'No cover note provided.'}</p><Button type="button" variant="outline" isLoading={downloadingResumeId === reviewApplicant.id} title={reviewApplicant.has_resume || reviewApplicant.resume_id ? `Download ${reviewApplicant.resume_filename || 'resume'}` : 'Resume not uploaded by the student'} className={!reviewApplicant.has_resume && !reviewApplicant.resume_id ? 'text-slate-400 dark:text-slate-500' : ''} onClick={() => void downloadResume(reviewApplicant)} leftIcon={<FileText className="h-4 w-4" />}>View resume</Button></div>}
      </Modal>
    </div>
  )
}
