import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Award, CheckCircle2, ChevronLeft, ChevronRight, FileText, Loader2, Send, Sparkles, Target } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { routes } from '../../lib/routes'

interface EligibilityBlocker {
  code: string
  message: string
  action_url?: string | null
  application_id?: number
  status?: string
}

export interface EligibilityResponse {
  can_apply: boolean
  blockers: EligibilityBlocker[]
  warnings: Array<{ code: string; message: string }>
  match_score: number
  matched_skills: string[]
  missing_skills: string[]
  resume: { filename: string; uploaded_at: string | null } | null
}

interface ApplyModalProps {
  isOpen: boolean
  onClose: () => void
  internshipId: number
  internshipTitle: string
  companyName?: string
  location?: string
  stipend?: number
  deadline?: string
  onApplied: (applicationId?: number) => void
  onAlreadyApplied?: () => void
}

const steps = ['Review', 'Resume & note', 'Confirm']

function formatDate(value?: string | null): string {
  if (!value) return 'Not specified'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function blockerActionLabel(code: string): string {
  if (code === 'PROFILE_INCOMPLETE') return 'Complete profile'
  if (code === 'RESUME_REQUIRED') return 'Upload resume'
  if (code === 'EMAIL_NOT_VERIFIED') return 'Verify email'
  if (code === 'ALREADY_APPLIED') return 'View application'
  return 'View details'
}

function EligibilitySkeleton() {
  return (
    <div role="status" aria-label="Loading application eligibility" className="space-y-4">
      <div className="h-2 w-full animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
      <div className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      <span className="sr-only">Loading eligibility and match details…</span>
    </div>
  )
}

export function ApplyModal({
  isOpen,
  onClose,
  internshipId,
  internshipTitle,
  companyName,
  location,
  stipend,
  deadline,
  onApplied,
  onAlreadyApplied,
}: ApplyModalProps) {
  const [eligibility, setEligibility] = useState<EligibilityResponse | null>(null)
  const [eligibilityError, setEligibilityError] = useState('')
  const [loadingEligibility, setLoadingEligibility] = useState(false)
  const [step, setStep] = useState(0)
  const [coverNote, setCoverNote] = useState('')
  const [error, setError] = useState<{ detail: string; code: string; blockers: EligibilityBlocker[] } | null>(null)
  const [generatingPitch, setGeneratingPitch] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [successApplicationId, setSuccessApplicationId] = useState<number | null>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    let current = true
    setLoadingEligibility(true)
    setEligibility(null)
    setEligibilityError('')
    setError(null)
    setStep(0)
    setCoverNote('')
    setSubmitted(false)
    setSuccessApplicationId(null)
    api.get(`/applications/eligibility/${internshipId}`)
      .then((response) => {
        if (current) setEligibility(response.data)
      })
      .catch((requestError: any) => {
        if (current) {
          setEligibilityError(requestError.response?.data?.detail || 'Unable to check application eligibility. Please try again.')
        }
      })
      .finally(() => {
        if (current) setLoadingEligibility(false)
      })
    return () => {
      current = false
    }
  }, [isOpen, internshipId])

  const generatePitch = async () => {
    setGeneratingPitch(true)
    setError(null)
    try {
      const response = await api.post(`/ai/internships/${internshipId}/generate-pitch`)
      if (response.data?.pitch) setCoverNote(response.data.pitch.slice(0, 1000))
    } catch {
      setError({
        detail: 'Unable to generate a pitch. Your existing note is unchanged; you can continue writing it yourself.',
        code: 'PITCH_GENERATION_FAILED',
        blockers: [],
      })
    } finally {
      setGeneratingPitch(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current || !eligibility?.can_apply) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await api.post(`/applications/internships/${internshipId}`, {
        cover_note: coverNote.trim() || null,
      })
      const applicationId = Number(response.data?.id)
      setSuccessApplicationId(Number.isInteger(applicationId) ? applicationId : null)
      setSubmitted(true)
      onApplied(Number.isInteger(applicationId) ? applicationId : undefined)
    } catch (requestError: any) {
      const data = requestError.response?.data || {}
      const blockers = Array.isArray(data.blockers) ? data.blockers : []
      const code = data.code || 'APPLICATION_FAILED'
      setError({
        detail: data.detail || 'Unable to submit your application. Please try again.',
        code,
        blockers,
      })
      if (code === 'ALREADY_APPLIED') onAlreadyApplied?.()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const canApply = eligibility?.can_apply === true
  const matchScore = eligibility?.match_score ?? 0
  const missingSkills = eligibility?.missing_skills ?? []
  const advice = matchScore >= 80
    ? 'Strong match'
    : matchScore >= 60
      ? `Good match, consider highlighting: ${missingSkills.length ? missingSkills.join(', ') : 'your relevant experience'}`
      : `Low match, you are missing: ${missingSkills.length ? missingSkills.join(', ') : 'some required skills'}. You can still apply.`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Apply for Internship"
      description={`Submit your application for "${internshipTitle}"${companyName ? ` at ${companyName}` : ''}.`}
      maxWidth="2xl"
    >
      {submitted ? (
        <div className="space-y-5 py-2 text-center" aria-live="polite">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Application submitted</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your profile and resume are now visible to the hiring team.</p>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            {successApplicationId !== null && (
              <Link to={routes.applications({ id: successApplicationId })} onClick={onClose}>
                <Button variant="primary">View application</Button>
              </Link>
            )}
            <Button variant="outline" onClick={onClose}>Keep exploring</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <ol aria-label="Application steps" className="grid grid-cols-3 gap-2">
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={step === index ? 'step' : undefined}
                className={`rounded-lg px-2 py-2 text-center text-xs font-semibold ${
                  step === index
                    ? 'bg-indigo-600 text-white'
                    : step > index
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <span className="mr-1">{index + 1}.</span>{label}
              </li>
            ))}
          </ol>

          {loadingEligibility ? (
            <EligibilitySkeleton />
          ) : eligibilityError ? (
            <div role="alert" aria-live="polite" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {eligibilityError}
            </div>
          ) : eligibility && (
            <>
              {eligibility.blockers.length > 0 && (
                <div className="space-y-2" aria-label="Application blockers">
                  {eligibility.blockers.map((blocker) => (
                    <div key={blocker.code} className="flex flex-col items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30 sm:flex-row sm:items-center">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{blocker.message}</p>
                        {blocker.code === 'ALREADY_APPLIED' && blocker.status && (
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Current status: {blocker.status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}</p>
                        )}
                      </div>
                      {blocker.code !== 'ALREADY_APPLIED' && blocker.action_url && (
                        <Link to={blocker.action_url} onClick={onClose} className="shrink-0">
                          <Button type="button" size="sm" variant="outline">
                            {blockerActionLabel(blocker.code)}
                          </Button>
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {step === 0 && (
                <section className="space-y-4" aria-labelledby="application-review-heading">
                  <h3 id="application-review-heading" className="text-sm font-bold text-slate-900 dark:text-white">Review internship</h3>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <h4 className="font-bold text-slate-900 dark:text-white">{internshipTitle}</h4>
                    {companyName && <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-300">{companyName}</p>}
                    <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
                      <div><dt className="font-semibold">Location</dt><dd>{location || 'Not specified'}</dd></div>
                      <div><dt className="font-semibold">Stipend</dt><dd>{stipend == null ? 'Not specified' : `${stipend.toLocaleString()} / month`}</dd></div>
                      <div><dt className="font-semibold">Deadline</dt><dd>{formatDate(deadline)}</dd></div>
                    </dl>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Target className="h-4 w-4 text-indigo-600" /> Match score</span>
                      <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-indigo-700 dark:bg-slate-900 dark:text-indigo-300">{matchScore}%</span>
                    </div>
                    <p className={`mt-2 text-sm font-semibold ${matchScore >= 80 ? 'text-emerald-700 dark:text-emerald-300' : matchScore >= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {advice}
                    </p>
                    {eligibility.matched_skills.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Award className="mr-1 h-4 w-4 text-emerald-600" />
                        {eligibility.matched_skills.map((skill) => <span key={skill} className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{skill}</span>)}
                      </div>
                    )}
                    {eligibility.missing_skills.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {eligibility.missing_skills.map((skill) => <span key={skill} className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{skill}</span>)}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {step === 1 && (
                <section className="space-y-4" aria-labelledby="resume-note-heading">
                  <h3 id="resume-note-heading" className="text-sm font-bold text-slate-900 dark:text-white">Resume & cover note</h3>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-5 w-5 shrink-0 text-indigo-600" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{eligibility.resume?.filename || 'No resume uploaded'}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{eligibility.resume ? eligibility.resume.uploaded_at ? `Uploaded ${formatDate(eligibility.resume.uploaded_at)}` : 'Upload date unavailable' : 'Upload or update your resume in your profile'}</p>
                      </div>
                    </div>
                    <Link to={routes.studentProfile} onClick={onClose} className="shrink-0 text-xs font-bold text-indigo-700 underline dark:text-indigo-300">
                      Change/Upload
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="application-cover-note" className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cover note (optional)</label>
                      <button type="button" onClick={generatePitch} disabled={generatingPitch} className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 disabled:opacity-50 dark:text-indigo-400">
                        {generatingPitch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {generatingPitch ? 'Generating…' : 'Generate with AI'}
                      </button>
                    </div>
                    <Textarea
                      id="application-cover-note"
                      rows={5}
                      maxLength={1000}
                      value={coverNote}
                      onChange={(event) => setCoverNote(event.target.value.slice(0, 1000))}
                      placeholder="Briefly highlight your relevant experience or interest in this role."
                    />
                    <p className="text-right text-xs text-slate-500 dark:text-slate-400">{coverNote.length}/1000</p>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section className="space-y-3" aria-labelledby="confirm-application-heading">
                  <h3 id="confirm-application-heading" className="text-sm font-bold text-slate-900 dark:text-white">Confirm your application</h3>
                  <div className="space-y-2 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
                    <p><span className="font-semibold">Role:</span> {internshipTitle}</p>
                    {companyName && <p><span className="font-semibold">Company:</span> {companyName}</p>}
                    <p><span className="font-semibold">Resume:</span> {eligibility.resume?.filename || 'No resume attached'}</p>
                    <p><span className="font-semibold">Cover note:</span> {coverNote.trim() ? `${coverNote.length} characters` : 'None'}</p>
                    <p><span className="font-semibold">Match score:</span> {matchScore}%</p>
                  </div>
                </section>
              )}
            </>
          )}

          {error && (
            <div role="alert" aria-live="polite" className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <p className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error.detail}</p>
              {error.blockers.map((blocker) => (
                <div key={blocker.code}>
                  {blocker.code === 'ALREADY_APPLIED' && blocker.status && (
                    <p className="mb-1 text-xs">Current status: {blocker.status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}</p>
                  )}
                  {blocker.code !== 'ALREADY_APPLIED' && blocker.action_url && (
                    <Link to={blocker.action_url} onClick={onClose} className="inline-flex rounded font-bold underline underline-offset-2">
                      {blockerActionLabel(blocker.code)}
                    </Link>
                  )}
                </div>
              ))}
              {error.code === 'ALREADY_APPLIED' && error.blockers[0]?.application_id && (
                <Link to={routes.applications({ id: error.blockers[0].application_id })} onClick={onClose} className="ml-2 inline-flex font-bold underline underline-offset-2">View application</Link>
              )}
              {error.code === 'APPLICATION_FAILED' && (
                <button type="button" onClick={() => setError(null)} className="font-bold underline underline-offset-2">Try again</button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button type="button" variant="outline" size="sm" onClick={step === 0 ? onClose : () => setStep((current) => Math.max(0, current - 1))}>
              {step === 0 ? 'Cancel' : <><ChevronLeft className="mr-1 h-4 w-4" /> Back</>}
            </Button>
            {step < 2 ? (
              !canApply && eligibility?.blockers.length ? (
                <Button type="button" variant="primary" size="sm" disabled title={eligibility.blockers.map((blocker) => blocker.message).join(' ')}>
                  Submit Application
                </Button>
              ) : (
                <Button type="button" variant="primary" size="sm" disabled={loadingEligibility || !eligibility} onClick={() => setStep((current) => Math.min(2, current + 1))}>
                  Continue <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )
            ) : (
              <Button type="submit" variant="primary" size="sm" disabled={loadingEligibility || !canApply || saving} isLoading={saving} leftIcon={<Send className="h-3.5 w-3.5" />} title={!canApply ? eligibility?.blockers.map((blocker) => blocker.message).join(' ') : undefined}>
                Submit Application
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}
