import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { DropdownSelect as OptionMenu } from '../ui/DropdownSelect'
import { Calendar, CheckCircle2, Clock, Sparkles, User, Briefcase, AlertCircle } from 'lucide-react'

const normalizeMeetingLink = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? url : null
  } catch {
    return null
  }
}

const interviewSchema = z.object({
  scheduled_at: z.string()
    .min(1, 'Interview date & time is required')
    .refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future date and time'),
  interview_type: z.enum(['VIDEO', 'PHONE', 'IN_PERSON']),
  meeting_link: z.string().trim().refine((value) => normalizeMeetingLink(value) !== null, 'Enter a valid http(s) meeting URL or leave it blank for in-app video'),
  notes: z.string().optional().or(z.literal('')),
})

type InterviewFormData = z.infer<typeof interviewSchema>

export interface RescheduleInterview {
  id: number
  scheduled_at: string
  interview_type: 'VIDEO' | 'PHONE' | 'IN_PERSON'
  meeting_link?: string | null
  notes?: string | null
}

export interface ScheduleInterviewModalProps {
  isOpen: boolean
  onClose: () => void
  applicationId?: number
  candidateName?: string
  jobId?: number
  jobTitle?: string
  onScheduled: () => void
  rescheduleInterview?: RescheduleInterview
}

export function ScheduleInterviewModal({
  isOpen,
  onClose,
  applicationId,
  candidateName,
  jobId,
  jobTitle,
  onScheduled,
  rescheduleInterview,
}: ScheduleInterviewModalProps) {
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')
  const [selectedDuration, setSelectedDuration] = useState('30 min')

  // Dynamic selection state when applicationId is not pre-provided
  const [jobs, setJobs] = useState<any[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | undefined>(jobId)
  const [candidates, setCandidates] = useState<any[]>([])
  const [selectedAppId, setSelectedAppId] = useState<number | undefined>(applicationId)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const localNow = new Date()
  localNow.setMinutes(localNow.getMinutes() - localNow.getTimezoneOffset())
  const minScheduledAt = localNow.toISOString().slice(0, 16)

  const activeAppId = applicationId || selectedAppId

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InterviewFormData>({
    resolver: zodResolver(interviewSchema),
    defaultValues: {
      interview_type: 'VIDEO',
      meeting_link: '',
    },
  })

  // Synchronize incoming props
  useEffect(() => {
    if (jobId) {
      setSelectedJobId(jobId)
    }
    if (applicationId) {
      setSelectedAppId(applicationId)
      setValue('meeting_link', '')
    }
  }, [jobId, applicationId, setValue])

  useEffect(() => {
    if (!rescheduleInterview) return
    const localDate = new Date(rescheduleInterview.scheduled_at)
    const pad = (value: number) => String(value).padStart(2, '0')
    setValue('scheduled_at', `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}T${pad(localDate.getHours())}:${pad(localDate.getMinutes())}`)
    setValue('interview_type', rescheduleInterview.interview_type)
    setValue('meeting_link', rescheduleInterview.meeting_link || '')
    setValue('notes', rescheduleInterview.notes || '')
  }, [rescheduleInterview, setValue])

  // Load jobs if neither applicationId nor jobId is passed
  useEffect(() => {
    if (isOpen && !applicationId && !jobId) {
      setLoadingOptions(true)
      api.get('/internships/company')
        .then((res) => {
          const list = res.data || []
          setJobs(list)
          if (list.length > 0 && !selectedJobId) {
            setSelectedJobId(list[0].id)
          }
        })
        .catch(() => {})
        .finally(() => setLoadingOptions(false))
    }
  }, [isOpen, applicationId, jobId])

  // Fetch applicants whenever selectedJobId changes (and no fixed applicationId)
  useEffect(() => {
    if (isOpen && !applicationId && selectedJobId) {
      setLoadingOptions(true)
      api.get(`/applications/internships/${selectedJobId}`)
        .then((res) => {
          const list = res.data || []
          setCandidates(list)
          if (list.length > 0) {
            setSelectedAppId(list[0].id)
          } else {
            setSelectedAppId(undefined)
          }
        })
        .catch(() => {
          setCandidates([])
          setSelectedAppId(undefined)
        })
        .finally(() => setLoadingOptions(false))
    }
  }, [isOpen, applicationId, selectedJobId, setValue])

  // Quick slot helpers (Tomorrow 10 AM, etc.)
  const generateQuickSlots = () => {
    const slots = []
    const now = new Date()

    const tomorrow10 = new Date(now)
    tomorrow10.setDate(tomorrow10.getDate() + 1)
    tomorrow10.setHours(10, 0, 0, 0)

    const tomorrow14 = new Date(now)
    tomorrow14.setDate(tomorrow14.getDate() + 1)
    tomorrow14.setHours(14, 30, 0, 0)

    const dayAfter11 = new Date(now)
    dayAfter11.setDate(dayAfter11.getDate() + 2)
    dayAfter11.setHours(11, 0, 0, 0)

    const in3Days15 = new Date(now)
    in3Days15.setDate(in3Days15.getDate() + 3)
    in3Days15.setHours(15, 0, 0, 0)

    slots.push({ label: 'Tomorrow 10:00 AM', date: tomorrow10 })
    slots.push({ label: 'Tomorrow 2:30 PM', date: tomorrow14 })
    slots.push({ label: 'In 2 Days 11:00 AM', date: dayAfter11 })
    slots.push({ label: 'In 3 Days 3:00 PM', date: in3Days15 })

    return slots
  }

  const handlePickSlot = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`
    setValue('scheduled_at', formatted, { shouldValidate: true })
  }

  const onSubmit = async (data: InterviewFormData) => {
    const targetAppId = applicationId || selectedAppId
    if (!targetAppId) {
      setServerError('Please select a candidate to interview.')
      return
    }

    setServerError('')
    try {
      const isoDate = new Date(data.scheduled_at).toISOString()

      const interviewPayload = {
        scheduled_at: isoDate,
        interview_type: data.interview_type,
        meeting_link: normalizeMeetingLink(data.meeting_link) || null,
        notes: rescheduleInterview
          ? data.notes?.trim() || null
          : data.notes ? `[Duration: ${selectedDuration}] ${data.notes.trim()}` : `Duration: ${selectedDuration}`,
      }
      if (new Date(isoDate).getTime() <= Date.now()) {
        setServerError('Choose a future date and time.')
        return
      }
      if (rescheduleInterview) {
        await api.patch(`/interviews/${rescheduleInterview.id}`, { status: 'RESCHEDULED', ...interviewPayload })
      } else {
        await api.post(`/applications/${targetAppId}/interviews`, interviewPayload)
      }

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
        onScheduled()
        onClose()
      }, 1500)
    } catch (err: any) {
      setServerError(err.response?.data?.detail || 'Failed to schedule interview. Please try again.')
    }
  }

  const activeCandidate = candidates.find((c) => c.id === selectedAppId)
  const currentCandidateName = candidateName || (activeCandidate ? activeCandidate.student_name || `Applicant #${activeCandidate.student_id}` : 'the candidate')

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={rescheduleInterview ? 'Reschedule Interview' : 'Schedule Interview'}
      description={`Invite ${currentCandidateName} to an interview.`}
      maxWidth="lg"
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 dark:text-emerald-400 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-semibold">Interview scheduled successfully!</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Candidate has been notified via in-app notification & email with instant calendar sync.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Candidate / Job Context Selector */}
          {applicationId ? (
            <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/60 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-600 text-white">
                <User className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  Candidate: {candidateName || `Application #${applicationId}`}
                </p>
                {jobTitle && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Role: {jobTitle}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
              {/* Job Selector (if not locked by jobId prop) */}
              {!jobId && (
                <OptionMenu
                  label="Internship Role"
                  value={String(selectedJobId || '')}
                  onChange={(value) => setSelectedJobId(Number(value))}
                  disabled={loadingOptions || jobs.length === 0}
                  options={jobs.map((job) => ({ label: `${job.title} (${job.status})`, value: String(job.id) }))}
                />
              )}

              {jobId && jobTitle && (
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Briefcase className="w-4 h-4 text-indigo-500" />
                  <span>Role: {jobTitle}</span>
                </div>
              )}

              {/* Candidate Picker */}
              {loadingOptions ? (
                <p className="text-xs text-slate-500">Loading candidates...</p>
              ) : candidates.length > 0 ? (
                <OptionMenu
                  label="Select Candidate"
                  value={String(selectedAppId || '')}
                  onChange={(value) => setSelectedAppId(Number(value))}
                  options={candidates.map((candidate) => ({
                    label: `${candidate.student_name || `Applicant #${candidate.student_id}`} (${candidate.status}) • ${candidate.student_university || 'Student'}`,
                    value: String(candidate.id),
                  }))}
                />
              ) : (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-900/60 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">No candidates have applied to this role yet.</p>
                    <p className="text-[11px] mt-0.5 text-amber-700 dark:text-amber-400">
                      Once candidates apply, you can schedule live technical or behavioral interviews directly.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!rescheduleInterview && (
          <>
          {/* Quick Calendly-style Slot Suggestions */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Quick Recommended Slots
            </label>
            <div className="grid grid-cols-2 gap-2">
              {generateQuickSlots().map((slot, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePickSlot(slot.date)}
                  className="px-2.5 py-1.5 text-left text-xs rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 text-slate-700 dark:text-slate-300 transition-colors flex items-center justify-between"
                >
                  <span>{slot.label}</span>
                  <Clock className="w-3 h-3 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
          </>
          )}

          <Input
            label="Date & Time"
            type="datetime-local"
            min={minScheduledAt}
            error={errors.scheduled_at?.message}
            {...register('scheduled_at')}
          />

          {/* Duration Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
              Session Duration
            </label>
            <div className="flex gap-2">
              {['30 min', '45 min', '60 min'].map((dur) => (
                <button
                  key={dur}
                  type="button"
                  onClick={() => setSelectedDuration(dur)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                    selectedDuration === dur
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {dur}
                </button>
              ))}
            </div>
          </div>

          <OptionMenu
            label="Interview Format"
            options={[
              { label: 'Video Call (In-App Encrypted WebRTC Room)', value: 'VIDEO' },
              { label: 'Phone Call', value: 'PHONE' },
              { label: 'In Person', value: 'IN_PERSON' },
            ]}
            value={watch('interview_type')}
            onChange={(value) => setValue('interview_type', value as InterviewFormData['interview_type'], { shouldValidate: true })}
          />

          <Input
            label="Meeting Link or Location"
            placeholder="meet.google.com/abc-defg-hij (leave blank for in-app video)"
            error={errors.meeting_link?.message}
            helperText="Enter an http(s) link, or leave blank to use the InternSphere video room"
            {...register('meeting_link')}
          />

          <Textarea
            label="Instructions / Notes for Candidate"
            placeholder="Please prepare code samples and review system design questions..."
            rows={3}
            error={errors.notes?.message}
            {...register('notes')}
          />

          {serverError && <p className="text-xs text-rose-600 font-medium">{serverError}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              disabled={!activeAppId}
              leftIcon={<Calendar className="w-3.5 h-3.5" />}
            >
              {rescheduleInterview ? 'Confirm Reschedule' : 'Confirm & Schedule'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
