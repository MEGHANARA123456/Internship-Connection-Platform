import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { ShieldAlert, CheckCircle2 } from 'lucide-react'

const reportSchema = z.object({
  reason: z.string().min(10, 'Reason must be at least 10 characters long').max(2000),
})

type ReportFormData = z.infer<typeof reportSchema>

interface ReportModalProps {
  isOpen: boolean
  onClose: () => void
  internshipId?: number
  reportedUserId?: number
  targetTitle?: string
}

export function ReportModal({
  isOpen,
  onClose,
  internshipId,
  reportedUserId,
  targetTitle,
}: ReportModalProps) {
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReportFormData>({
    resolver: zodResolver(reportSchema),
  })

  const onSubmit = async (data: ReportFormData) => {
    setServerError('')
    try {
      await api.post('/reports', {
        reason: data.reason,
        internship_id: internshipId,
        reported_user_id: reportedUserId,
      })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
        onClose()
      }, 1500)
    } catch (err: unknown) {
      setServerError('Failed to submit report. Please try again.')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Submit a Dispute / Report"
      description={`Report ${targetTitle ? `"${targetTitle}"` : 'this issue'} to platform moderators.`}
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          <p className="text-sm font-medium">Report submitted to administrators. Thank you.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5 text-xs text-slate-600">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              All reports are reviewed by platform administrators within 24-48 hours. Please provide clear details.
            </span>
          </div>

          <Textarea
            label="Reason for report"
            placeholder="Describe what happened or why this content violates community guidelines..."
            rows={4}
            error={errors.reason?.message}
            {...register('reason')}
          />

          {serverError && <p className="text-xs text-rose-600 font-medium">{serverError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" isLoading={isSubmitting}>
              Submit Report
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
