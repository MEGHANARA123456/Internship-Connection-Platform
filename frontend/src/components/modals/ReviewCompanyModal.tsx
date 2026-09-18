import { useState } from 'react'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Star, CheckCircle2, ShieldCheck, AlertCircle } from 'lucide-react'

interface ReviewCompanyModalProps {
  isOpen: boolean
  onClose: () => void
  companyId: number
  internshipId: number
  companyName: string
  internshipTitle?: string
  onReviewSubmitted?: () => void
}

export function ReviewCompanyModal({
  isOpen,
  onClose,
  companyId,
  internshipId,
  companyName,
  internshipTitle,
  onReviewSubmitted,
}: ReviewCompanyModalProps) {
  const [rating, setRating] = useState<number>(5)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    if (rating < 1 || rating > 5) {
      setServerError('Please select a star rating from 1 to 5.')
      return
    }

    if (comment.trim().length < 10) {
      setServerError('Please provide at least 10 characters of constructive review feedback.')
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/companies/${companyId}/reviews`, {
        internship_id: internshipId,
        rating,
        review_text: comment.trim(),
      })
      setSuccess(true)
      if (onReviewSubmitted) onReviewSubmitted()
      setTimeout(() => {
        setSuccess(false)
        setComment('')
        setRating(5)
        onClose()
      }, 1800)
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Unable to submit review. You must be a selected intern for this role.'
      setServerError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Review & Rate ${companyName}`}
      description={internshipTitle ? `Share your internship experience for ${internshipTitle}` : 'Share your verified intern feedback'}
      maxWidth="md"
    >
      {success ? (
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 dark:text-emerald-300 space-y-2">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-bold">Review Successfully Submitted!</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Your verified review is now live and will help fellow students discover great employers.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Verified Badge Notice */}
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <strong>Verified Intern Review:</strong> Because your application was Selected, your review carries a verified badge to ensure honest, high-trust ratings.
            </span>
          </div>

          {/* Star Rating Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              Overall Rating
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const isFilled = (hoverRating !== null ? hoverRating : rating) >= star
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    className="p-1 text-slate-300 dark:text-slate-600 hover:scale-110 transition-transform cursor-pointer"
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                  >
                    <Star
                      className={`w-7 h-7 ${
                        isFilled
                          ? 'fill-amber-400 text-amber-400'
                          : 'fill-none text-slate-300 dark:text-slate-600'
                      }`}
                    />
                  </button>
                )
              })}
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 ml-2">
                {rating} out of 5
              </span>
            </div>
          </div>

          {/* Review Comment */}
          <div>
            <Textarea
              label="Detailed Review & Experience"
              placeholder="Share details about the work environment, learning opportunities, stipend timeliness, and guidance..."
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
            />
          </div>

          {serverError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={submitting}>
              Submit Verified Review
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
