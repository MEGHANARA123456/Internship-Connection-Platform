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
import { Calendar, CheckCircle2 } from 'lucide-react'

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InterviewFormData>({
    resolver: zodResolver(interviewSchema),
    defaultValues: {
      interview_type: 'VIDEO',
    },
  })

  const onSubmit = async (data: InterviewFormData) => {
    setServerError('')
    try {
      // Format datetime to ISO
      const isoDate = new Date(data.scheduled_at).toISOString()

      await api.post(`/applications/${applicationId}/interviews`, {
        scheduled_at: isoDate,
        interview_type: data.interview_type,
        meeting_link: data.meeting_link?.trim() || null,
        notes: data.notes?.trim() || null,
      })

      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
        onScheduled()
        onClose()
      }, 1500)
    } catch (err: unknown) {
      setServerError('Failed to schedule interview. Ensure application is Shortlisted.')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Interview"
      description={`Invite ${candidateName || 'the candidate'} to an interview.`}
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          <p className="text-sm font-semibold">Interview scheduled successfully!</p>
          <p className="text-xs text-slate-500">Candidate has been notified via in-app notification & email.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Date & Time"
            type="datetime-local"
            error={errors.scheduled_at?.message}
            {...register('scheduled_at')}
          />

          <Select
            label="Interview Format"
            options={[
              { label: 'Video Call (Google Meet, Zoom, etc.)', value: 'VIDEO' },
              { label: 'Phone Call', value: 'PHONE' },
              { label: 'In Person', value: 'IN_PERSON' },
            ]}
            error={errors.interview_type?.message}
            {...register('interview_type')}
          />

          <Input
            label="Meeting Link or Location"
            placeholder="https://meet.google.com/abc-defg-hij"
            error={errors.meeting_link?.message}
            helperText="Provide video meeting link or office address"
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

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
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
