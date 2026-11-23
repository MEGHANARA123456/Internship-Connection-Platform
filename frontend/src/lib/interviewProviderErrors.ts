export function studentProviderFailureMessage(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    provider_rate_limited: 'The AI evaluator is busy right now. Your answers are saved; try again shortly.',
    evaluation_provider_rate_limited: 'The AI evaluator is busy right now. Your answers are saved; try again shortly.',
    provider_insufficient_quota: 'AI evaluation is unavailable right now. Your answers are saved. Please try again later.',
    evaluation_provider_insufficient_quota: 'AI evaluation is unavailable right now. Your answers are saved. Please try again later.',
    provider_invalid_key: "We couldn't complete AI evaluation. Your answers are saved; please try again later.",
    evaluation_provider_invalid_key: "We couldn't complete AI evaluation. Your answers are saved; please try again later.",
    provider_model_not_found: 'AI evaluation is temporarily unavailable. Your answers are saved.',
    evaluation_provider_model_not_found: 'AI evaluation is temporarily unavailable. Your answers are saved.',
    provider_not_configured: 'Evaluation is temporarily unavailable. Your answers are saved.',
    evaluation_provider_not_configured: 'Evaluation is temporarily unavailable. Your answers are saved.',
    provider_timeout: 'Evaluation timed out. Your answer is saved.',
    evaluation_provider_timeout: 'Evaluation timed out. Your answers are saved.',
    provider_unavailable: 'The evaluation service is unavailable. Your answer is saved.',
    evaluation_provider_unavailable: 'The evaluation service is unavailable. Your answers are saved.',
    provider_rejected_request: 'The evaluation service could not process this answer. Your answer is saved.',
  }
  return code ? messages[code] ?? 'This answer could not be evaluated. Your answer is saved.' : 'Evaluation is temporarily unavailable. Your answers are saved.'
}

export function retryAfterSecondsFromError(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('response' in error)) return 0
  const response = (error as {
    response?: {
      headers?: Record<string, unknown> & { get?: (name: string) => unknown }
    }
  }).response
  const headers = response?.headers
  const value = headers?.get?.('Retry-After')
    ?? headers?.['retry-after']
    ?? headers?.['Retry-After']
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0
}
