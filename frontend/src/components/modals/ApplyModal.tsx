import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Send, CheckCircle2, AlertCircle } from 'lucide-react'

const applySchema = z.object({
  cover_note: z.string().max(3000, 'Cover note cannot exceed 3000 characters').optional().or(z.literal('')),
})

type ApplyFormData = z.infer<typeof applySchema>

interface ApplyModalProps {
  isOpen: boolean
  onClose: () => void
  internshipId: number
  internshipTitle: string
  companyName?: string
  onApplied: () => void
}

export function ApplyModal({
  isOpen,
  onClose,
  internshipId,
  internshipTitle,
  companyName,
  onApplied,
}: ApplyModalProps) {
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ApplyFormData>({
    resolver: zodResolver(applySchema),
  })

  const onSubmit = async (data: ApplyFormData) => {
    setServerError('')
    try {
      await api.post(`/applications/internships/${internshipId}`, {
        cover_note: data.cover_note?.trim() || null,
      })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        reset()
        onApplied()
        onClose()
      }, 1500)
    } catch (err: any) {
      if (err.response?.status === 409) {
        setServerError('You have already applied to this internship.')
      } else {
        setServerError('Unable to submit application. Please verify your profile and try again.')
      }
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Apply for Internship"
      description={`Submit your application for "${internshipTitle}"${companyName ? ` at ${companyName}` : ''}.`}
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          <p className="text-sm font-semibold">Application submitted successfully!</p>
          <p className="text-xs text-slate-500">Your profile and resume are now visible to the hiring team.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-lg text-xs text-indigo-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <span>
              Your current profile information and uploaded resume will be attached to this application automatically.
            </span>
          </div>

          <Textarea
            label="Cover Note (Optional)"
            placeholder="Introduce yourself, highlight relevant projects or skills, and explain why you're a great fit..."
            rows={4}
            error={errors.cover_note?.message}
            {...register('cover_note')}
          />

          {serverError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium bg-rose-50 p-2.5 rounded-lg border border-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              leftIcon={<Send className="w-3.5 h-3.5" />}
            >
              Submit Application
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
