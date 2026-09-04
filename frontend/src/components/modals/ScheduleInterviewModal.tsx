import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Calendar, CheckCircle2, Clock, Sparkles } from 'lucide-react'

const interviewSchema = z.object({
  scheduled_at: z.string().min(1, 'Interview date & time is required'),
  interview_type: z.enum(['VIDEO', 'PHONE', 'IN_PERSON']),
  meeting_link: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
})

type InterviewFormData = z.infer<typeof interviewSchema>

interface ScheduleInterviewModalProps {
  isOpen: boolean
  onClose: () => void
  applicationId: number
  candidateName?: string
  onScheduled: () => void
}

export function ScheduleInterviewModal({
  isOpen,
  onClose,
  applicationId,
  candidateName,
  onScheduled,
}: ScheduleInterviewModalProps) {
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')
  const [selectedDuration, setSelectedDuration] = useState('45 min')

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InterviewFormData>({
    resolver: zodResolver(interviewSchema),
    defaultValues: {
      interview_type: 'VIDEO',
      meeting_link: `In-App Encrypted Video Room #${applicationId}`,
    },
  })

  // Generates quick time slot helpers (Tomorrow 10 AM, etc.)
  const generateQuickSlots = () => {
    const slots = []
    const now = new Date()

    // Tomorrow 10:00 AM
    const tomorrow10 = new Date(now)
    tomorrow10.setDate(tomorrow10.getDate() + 1)
    tomorrow10.setHours(10, 0, 0, 0)

    // Tomorrow 2:30 PM
    const tomorrow14 = new Date(now)
    tomorrow14.setDate(tomorrow14.getDate() + 1)
    tomorrow14.setHours(14, 30, 0, 0)

    // In 2 days 11:00 AM
    const dayAfter11 = new Date(now)
    dayAfter11.setDate(dayAfter11.getDate() + 2)
    dayAfter11.setHours(11, 0, 0, 0)

    // In 3 days 3:00 PM
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
    // Format to YYYY-MM-DDTHH:mm for datetime-local input
    const pad = (n: number) => String(n).padStart(2, '0')
    const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`
    setValue('scheduled_at', formatted, { shouldValidate: true })
  }

  const onSubmit = async (data: InterviewFormData) => {
    setServerError('')
    try {
      const isoDate = new Date(data.scheduled_at).toISOString()

      await api.post(`/applications/${applicationId}/interviews`, {
        scheduled_at: isoDate,
        interview_type: data.interview_type,
        meeting_link: data.meeting_link?.trim() || null,
        notes: data.notes ? `[Duration: ${selectedDuration}] ${data.notes.trim()}` : `Duration: ${selectedDuration}`,
      })

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
        onScheduled()
        onClose()
      }, 1500)
    } catch {
      setServerError('Failed to schedule interview. Ensure application is Shortlisted.')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Interview"
      description={`Invite ${candidateName || 'the candidate'} to an interview.`}
      maxWidth="lg"
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 dark:text-emerald-400 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-semibold">Interview scheduled successfully!</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Candidate has been notified via in-app notification & email with instant calendar sync.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

          <Input
            label="Date & Time"
            type="datetime-local"
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

          <Select
            label="Interview Format"
            options={[
              { label: 'Video Call (In-App Encrypted WebRTC Room)', value: 'VIDEO' },
              { label: 'Phone Call', value: 'PHONE' },
              { label: 'In Person', value: 'IN_PERSON' },
            ]}
            error={errors.interview_type?.message}
            {...register('interview_type')}
          />

          <Input
            label="Meeting Link or Location"
            placeholder="https://meet.google.com/abc-defg-hij or In-App Room"
            error={errors.meeting_link?.message}
            helperText="Provide video meeting link or in-app session link"
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
              leftIcon={<Calendar className="w-3.5 h-3.5" />}
            >
              Confirm & Schedule
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
