import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { CheckCircle2, Send } from 'lucide-react'

interface RecommendationModalProps {
  isOpen: boolean
  onClose: () => void
  onRecommendationAdded: (rec: {
    mentorName: string
    title: string
    institution: string
    quote: string
    date: string
  }) => void
}

export function RecommendationModal({
  isOpen,
  onClose,
  onRecommendationAdded,
}: RecommendationModalProps) {
  const [mentorName, setMentorName] = useState('')
  const [title, setTitle] = useState('')
  const [institution, setInstitution] = useState('')
  const [quote, setQuote] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!mentorName.trim() || !title.trim() || !quote.trim()) return

    onRecommendationAdded({
      mentorName: mentorName.trim(),
      title: title.trim(),
      institution: institution.trim() || 'Academic Institution',
      quote: quote.trim(),
      date: new Date().toLocaleDateString(),
    })

    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      setMentorName('')
      setTitle('')
      setInstitution('')
      setQuote('')
      onClose()
    }, 1200)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request Faculty & Mentor Endorsement"
      description="Add verified recommendations from professors, lab directors, or previous team leads."
      maxWidth="md"
    >
      {success ? (
        <div className="text-center py-6 space-y-2 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-10 h-10 mx-auto" />
          <h4 className="text-sm font-bold">Endorsement Added Successfully!</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This recommendation is now featured on your candidate profile.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Input
            label="Faculty / Mentor Name"
            placeholder="Dr. Rajesh Ramanathan"
            value={mentorName}
            onChange={(e) => setMentorName(e.target.value)}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Designation / Role"
              placeholder="Professor of Computer Science"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <Input
              label="University / Organization"
              placeholder="Stanford University"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>

          <Textarea
            label="Endorsement Note / Recommendation"
            placeholder="Describe the candidate's technical aptitude, research ethics, and teamwork..."
            rows={3}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            required
          />

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              leftIcon={<Send className="w-3.5 h-3.5" />}
              disabled={!mentorName.trim() || !title.trim() || !quote.trim()}
            >
              Add Endorsement
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
