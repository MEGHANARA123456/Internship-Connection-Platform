import axios from 'axios'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../ui/Button'
import { routes } from '../../lib/routes'

const knownErrors: Record<string, string> = {
  daily_session_limit_reached: 'You have reached the limit of five interview sessions today. Try again tomorrow.',
  session_expired: 'This interview has expired. Your saved answers are still available in your history.',
  question_bank_not_seeded: 'Interview questions are not available yet. Please try again later.',
  question_bank_empty: 'No interview questions are available for this selection yet.',
  no_answers_to_evaluate: 'Submit at least one answer before completing this interview.',
  assessment_answer_already_submitted: 'This Assessment answer was already submitted.',
  invalid_session_transition: 'This interview has changed state. Refresh it before continuing.',
  report_not_found: 'A report is not available for this interview yet.',
  provider_not_configured: 'Interview evaluation is not configured. Your answer has been saved.',
  provider_timeout: 'The evaluation service took too long to respond. Your answer has been saved.',
  provider_rate_limited: 'The evaluation service is busy. Your answer has been saved; try again shortly.',
  provider_unavailable: 'The evaluation service is unavailable. Your answer has been saved.',
  provider_rejected_request: 'The evaluation service could not process this answer. Your answer has been saved.',
  invalid_model_output: 'The evaluation service returned an invalid response. Your answer has been saved.',
  evaluation_failed: 'Some answers could not be evaluated. You can retry the evaluation.',
}

export function interviewErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}

export function interviewErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
  }
  if (!error.response) return 'Could not connect to the interview service. Check your connection and retry.'
  const { status, data } = error.response
  const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : undefined
  const detailText = typeof detail === 'string'
    ? detail
    : Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string'
      ? detail[0].msg.replace(/^Value error,\s*/i, '')
      : undefined
  if (detailText && knownErrors[detailText]) return knownErrors[detailText]
  if (status === 401) return 'Your session has expired. Sign in again to continue.'
  if (status === 403) return 'Your account cannot access this interview.'
  if (status === 404) return 'This interview could not be found. It may have been deleted.'
  if (status === 429) return 'You have reached the interview request limit. Please wait and try again.'
  if (status >= 500) return 'The interview service is temporarily unavailable. Please retry.'
  if (detailText) return detailText
  return 'The request could not be completed. Please retry.'
}

export function useInterviewError() {
  const navigate = useNavigate()
  return useCallback((error: unknown, returnTo: string): string => {
    if (interviewErrorStatus(error) === 401) {
      navigate(routes.login({ next: returnTo }), { replace: true })
      return ''
    }
    return interviewErrorMessage(error)
  }, [navigate])
}

export function InterviewErrorNotice({
  message,
  onRetry,
  retrying = false,
}: {
  message: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 sm:flex-row sm:items-center sm:justify-between">
      <p>{message}</p>
      {onRetry && <Button variant="outline" size="sm" isLoading={retrying} onClick={onRetry}>Retry</Button>}
    </div>
  )
}
