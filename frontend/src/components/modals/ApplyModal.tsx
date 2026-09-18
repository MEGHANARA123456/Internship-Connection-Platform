import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../../api/client'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Send, CheckCircle2, AlertCircle, Sparkles, Target, Award, Lightbulb, Loader2 } from 'lucide-react'

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

interface AtsScoreData {
  score: number
  matched_skills: string[]
  missing_skills: string[]
  suggestions: string[]
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
  const [isGeneratingPitch, setIsGeneratingPitch] = useState(false)
  const [atsData, setAtsData] = useState<AtsScoreData | null>(null)
  const [isLoadingAts, setIsLoadingAts] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ApplyFormData>({
    resolver: zodResolver(applySchema),
  })


  useEffect(() => {
    if (!isOpen) {
      setAtsData(null)
      return
    }

    setIsLoadingAts(true)
    api
      .get(`/ai/internships/${internshipId}/ats-score`)
      .then((res) => setAtsData(res.data))
      .catch(() => {})
      .finally(() => setIsLoadingAts(false))
  }, [isOpen, internshipId])

  const handleGeneratePitch = async () => {
    setIsGeneratingPitch(true)
    setServerError('')
    try {
      const res = await api.post(`/ai/internships/${internshipId}/generate-pitch`)
      if (res.data?.pitch) {
        setValue('cover_note', res.data.pitch, { shouldValidate: true })
      }
    } catch {
      setServerError('Unable to generate AI pitch. You can write your custom cover note below.')
    } finally {
      setIsGeneratingPitch(false)
    }
  }

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
        <div className="flex flex-col items-center justify-center p-6 text-center text-emerald-700 dark:text-emerald-400 space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-semibold">Application submitted successfully!</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Your profile and resume are now visible to the hiring team.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* AI ATS Match Score Banner */}
          {isLoadingAts ? (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>Analyzing resume and calculating ATS Match Score...</span>
            </div>
          ) : atsData ? (
            <div className="p-3.5 bg-gradient-to-r from-indigo-50/80 to-purple-50/80 dark:from-indigo-950/40 dark:to-purple-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white">AI ATS Match Score</span>
                </div>
                <span
                  className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                    atsData.score >= 80
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                      : atsData.score >= 60
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                      : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {atsData.score}% Match
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    atsData.score >= 80 ? 'bg-emerald-500' : atsData.score >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${atsData.score}%` }}
                />
              </div>

              {/* Matched skills */}
              {atsData.matched_skills.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                  <Award className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">Matched:</span>
                  {atsData.matched_skills.slice(0, 4).map((skill) => (
                    <span key={skill} className="px-1.5 py-0.5 bg-emerald-100/70 dark:bg-emerald-950/60 rounded text-[10px] text-emerald-800 dark:text-emerald-300">
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {atsData.suggestions.length > 0 && (
                <div className="flex items-start gap-1.5 text-[11px] text-indigo-700 dark:text-indigo-300 pt-0.5">
                  <Lightbulb className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                  <span>{atsData.suggestions[0]}</span>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cover Note</label>
              <button
                type="button"
                onClick={handleGeneratePitch}
                disabled={isGeneratingPitch}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:underline disabled:opacity-50"
              >
                {isGeneratingPitch ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Drafting pitch...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Generate with AI</span>
                  </>
                )}
              </button>
            </div>

            <Textarea
              placeholder="Introduce yourself, highlight relevant projects, or click 'Generate with AI' to draft a tailored pitch..."
              rows={5}
              error={errors.cover_note?.message}
              {...register('cover_note')}
            />

            {/* Application Quality Nudge */}
            {(() => {
              const note = watch('cover_note') || ''
              const words = note.trim() ? note.trim().split(/\s+/).length : 0
              if (words > 0 && words < 25) {
                return (
                  <div className="p-2.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Application Quality Nudge:</span> Your note is only {words} words. Candidates with specific project details get 3x more interview requests. Click <span className="font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer underline" onClick={handleGeneratePitch}>Generate with AI</span> to expand into a tailored pitch.
                    </div>
                  </div>
                )
              }
              return null
            })()}
          </div>


          {serverError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium bg-rose-50 dark:bg-rose-950/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-900">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
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
