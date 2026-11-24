import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Pencil, Plus, Power } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { DataList } from '../../components/ui/DataList'
import { IconButton } from '../../components/ui/IconButton'
import { queryClient } from '../../lib/queryClient'
import {
  approveAdminInterviewQuestion,
  createAdminInterviewQuestion,
  createAdminInterviewTest,
  getAdminInterviewAnalytics,
  getAdminInterviewAudit,
  getAdminInterviewFailures,
  getAdminInterviewProviderStatus,
  getAdminInterviewSettings,
  getAdminInterviewTaxonomy,
  importAdminInterviewQuestions,
  listAdminInterviewQuestions,
  listAdminInterviewTests,
  retryAdminInterviewFailures,
  updateAdminInterviewQuestion,
  updateAdminInterviewSettings,
  updateAdminInterviewTest,
  type AdminInterviewQuestion,
  type AdminInterviewProviderStatus,
  type AdminInterviewSettings,
  type AdminInterviewTest,
} from '../../services/interviewStudioAdminService'

type Tab = 'questions' | 'tests' | 'taxonomy' | 'settings' | 'analytics' | 'audit'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'questions', label: 'Question bank' },
  { id: 'tests', label: 'Mock tests' },
  { id: 'taxonomy', label: 'Categories' },
  { id: 'settings', label: 'Settings' },
  { id: 'analytics', label: 'Usage & failures' },
  { id: 'audit', label: 'Audit log' },
]
const categories = ['HR', 'TECHNICAL'] as const

function messageFromError(error: unknown): string {
  const response = typeof error === 'object' && error !== null && 'response' in error
    ? (error as { response?: { status?: number; data?: { detail?: unknown }; headers?: Record<string, unknown> } }).response
    : undefined
  if (response?.status === 401 || response?.status === 403) {
    return "You don't have permission to view this section."
  }
  if (response?.status === 404) return "This section isn't available yet."
  if (response?.status === 429) return 'Too many requests, retrying in a few seconds.'
  const providerErrorMessages: Record<string, string> = {
    evaluation_provider_not_configured: "AI evaluation isn't configured yet. Configure the provider API key and retry.",
    evaluation_provider_timeout: 'The AI provider timed out. Retry the evaluation shortly.',
    evaluation_provider_rate_limited: 'AI provider rate limit reached (429). Wait for the retry delay before trying again.',
    evaluation_provider_insufficient_quota: 'The AI provider account has insufficient quota or billing. Resolve that with the provider before retrying.',
    evaluation_provider_invalid_key: 'The AI provider API key was rejected (401). Update INTERVIEW_LLM_API_KEY.',
    evaluation_provider_model_not_found: 'The configured AI model was not found (404). Check INTERVIEW_LLM_MODEL.',
    evaluation_provider_rejected: 'The AI provider rejected the request. Check provider configuration.',
    evaluation_provider_unavailable: 'The AI provider is unavailable. Retry the evaluation shortly.',
  }
  if (typeof response?.data?.detail === 'string' && providerErrorMessages[response.data.detail]) {
    return providerErrorMessages[response.data.detail]
  }
  if (response && response.status !== undefined && response.status >= 500) {
    return 'Something went wrong on our side. Please retry.'
  }
  if (!response) return "Can't reach the server. Check your connection and retry."
  if (typeof response.data?.detail === 'string') return response.data.detail
  return error instanceof Error ? error.message : 'The request failed. Please retry.'
}

function retryAfterSeconds(error: unknown): number {
  if (typeof error !== 'object' || error === null || !('response' in error)) return 0
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown> } }).response
  if (response?.status !== 429) return 0
  const value = response.headers?.['retry-after'] ?? response.headers?.['Retry-After']
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 3
}

async function cachedAdminRequest<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
  force = false,
): Promise<T> {
  if (force) await queryClient.invalidateQueries({ queryKey, exact: true })
  return queryClient.fetchQuery({
    queryKey,
    queryFn,
    staleTime: 30_000,
    retry: false,
  })
}

function failureReasonLabel(code: string): string {
  const labels: Record<string, string> = {
    provider_not_configured: 'AI provider not configured',
    provider_api_key_missing: 'AI provider not configured',
    provider_timeout: 'AI provider timed out',
    provider_rate_limited: 'Rate limit (temporary)',
    provider_insufficient_quota: 'Insufficient quota or billing',
    provider_invalid_key: 'Invalid provider API key',
    provider_model_not_found: 'Configured model not found',
    provider_rejected_request: 'AI provider rejected the request',
    provider_unavailable: 'AI provider unavailable',
    proctoring_violations: 'Proctoring violations',
    evaluation_failed: 'Evaluation failed',
    report_failed: 'Report generation failed',
    provider_failed: 'Provider request failed',
  }
  return labels[code] ?? code.replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function providerStatusMessage(code: string | null): string {
  const messages: Record<string, string> = {
    provider_api_key_missing: 'Provider not configured: add INTERVIEW_LLM_API_KEY.',
    provider_not_configured: 'Provider configuration is incomplete. Check the provider and model settings.',
    provider_rate_limited: 'AI provider rate limit reached (429). Wait for the retry delay before trying again.',
    provider_insufficient_quota: 'The AI provider account has insufficient quota or billing. Resolve that with the provider before retrying.',
    provider_invalid_key: 'The AI provider API key was rejected (401). Update INTERVIEW_LLM_API_KEY.',
    provider_model_not_found: 'The configured AI model was not found (404). Check INTERVIEW_LLM_MODEL.',
    provider_timeout: 'The AI provider request timed out. Retry shortly.',
    provider_unavailable: 'The AI provider is unavailable. Retry shortly.',
    provider_rejected_request: 'The AI provider rejected the request. Check provider configuration.',
  }
  return code ? messages[code] ?? 'The AI provider is currently unavailable.' : "AI evaluation isn't configured yet."
}

function usageDateLabel(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    question_created: 'Question created',
    question_updated: 'Question updated',
    question_approved: 'Question approved',
    questions_imported: 'Questions imported',
    test_created: 'Test created',
    test_updated: 'Test updated',
    category_created: 'Category created',
    category_updated: 'Category updated',
    settings_updated: 'Settings updated',
    evaluation_retry_batch: 'Evaluation retry batch',
  }
  return labels[action] ?? action.replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function auditActionVariant(action: string): 'emerald' | 'amber' | 'indigo' | 'slate' {
  if (action.includes('approved') || action.includes('created') || action.includes('imported')) return 'emerald'
  if (action.includes('updated')) return 'amber'
  if (action.includes('retry')) return 'indigo'
  return 'slate'
}

function auditEntityLabel(entityType: string): string {
  const labels: Record<string, string> = {
    question: 'Question',
    question_bank: 'Question bank',
    test: 'Test',
    category: 'Category',
    settings: 'Settings',
    evaluation: 'Evaluation',
  }
  return labels[entityType] ?? entityType.replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Active' : 'Inactive'
  if (typeof value === 'string') {
    if (value === 'DRAFT-for-review') return 'Draft'
    return value.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function auditChangeSummary(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '—'
  const summary = value as { before?: unknown; after?: unknown }
  const before = typeof summary.before === 'object' && summary.before !== null
    ? summary.before as Record<string, unknown>
    : {}
  const after = typeof summary.after === 'object' && summary.after !== null
    ? summary.after as Record<string, unknown>
    : {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const changed = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  if (!changed.length) return '—'
  const labels: Record<string, string> = { review_status: 'Status', active: 'State' }
  return changed.map((key) => {
    const label = labels[key] ?? key.replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
    return `${label}: ${formatAuditValue(before[key])} → ${formatAuditValue(after[key])}`
  }).join(' · ')
}

function formatAuditDate(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${day}, ${time}`
}

function inputClass() {
  return 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
}

const blankQuestion = {
  seed_key: '',
  category: 'HR',
  prompt: '',
  hint: '',
  rubric: '',
}

export function InterviewStudioAdminPage() {
  const [tab, setTab] = useState<Tab>('questions')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [retryWait, setRetryWait] = useState(0)
  const [questions, setQuestions] = useState<AdminInterviewQuestion[]>([])
  const [questionDraft, setQuestionDraft] = useState(blankQuestion)
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [questionCategory, setQuestionCategory] = useState<'HR' | 'TECHNICAL'>('HR')
  const [questionCounts, setQuestionCounts] = useState({ HR: 0, TECHNICAL: 0 })
  const [testCategory, setTestCategory] = useState<'HR' | 'TECHNICAL'>('HR')
  const [testCounts, setTestCounts] = useState({ HR: 0, TECHNICAL: 0 })
  const [tests, setTests] = useState<AdminInterviewTest[]>([])
  const [testDraft, setTestDraft] = useState({
    slug: '',
    title: '',
    description: '',
    category_id: '',
    format: 'QUICK_PRACTICE',
    default_mode: 'PRACTICE',
    question_count: '5',
    time_limit_seconds: '600',
    company_style: false,
    active: true,
    question_ids: '',
  })
  const [editingTest, setEditingTest] = useState<number | null>(null)
  const [taxonomy, setTaxonomy] = useState<Awaited<ReturnType<typeof getAdminInterviewTaxonomy>> | null>(null)
  const [settings, setSettings] = useState<AdminInterviewSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<AdminInterviewProviderStatus | null>(null)
  const [providerStatusError, setProviderStatusError] = useState('')
  const [providerStatusLoading, setProviderStatusLoading] = useState(false)
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null)
  const [failures, setFailures] = useState<Record<string, unknown> | null>(null)
  const [analyticsError, setAnalyticsError] = useState('')
  const [failuresError, setFailuresError] = useState('')
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [failuresLoading, setFailuresLoading] = useState(false)
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([])
  const [auditAction, setAuditAction] = useState('')
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [auditLoadingMore, setAuditLoadingMore] = useState(false)
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null)
  const visibleQuestions = useMemo(
    () => questions.filter((question) => (
      question.category === questionCategory
    )),
    [questions, questionCategory],
  )

  useEffect(() => {
    if (retryWait <= 0) return
    const timer = window.setTimeout(() => setRetryWait((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [retryWait])

  const noteRateLimit = (loadError: unknown) => {
    const seconds = retryAfterSeconds(loadError)
    if (seconds > 0) setRetryWait((current) => Math.max(current, seconds))
  }

  const loadAnalytics = useCallback(async (force = false) => {
    setAnalyticsLoading(true)
    setAnalyticsError('')
    try {
      setAnalytics(await cachedAdminRequest(
        ['admin-interview-studio', 'analytics'],
        getAdminInterviewAnalytics,
        force,
      ))
    } catch (loadError) {
      noteRateLimit(loadError)
      setAnalyticsError(messageFromError(loadError))
    } finally {
      setAnalyticsLoading(false)
    }
  }, [])

  const loadFailures = useCallback(async (force = false) => {
    setFailuresLoading(true)
    setFailuresError('')
    try {
      setFailures(await cachedAdminRequest(
        ['admin-interview-studio', 'failures'],
        getAdminInterviewFailures,
        force,
      ))
    } catch (loadError) {
      noteRateLimit(loadError)
      setFailuresError(messageFromError(loadError))
    } finally {
      setFailuresLoading(false)
    }
  }, [])

  const loadProviderStatus = useCallback(async (force = false) => {
    setProviderStatusLoading(true)
    setProviderStatusError('')
    try {
      setProviderStatus(await cachedAdminRequest(
        ['admin-interview-studio', 'provider-status'],
        getAdminInterviewProviderStatus,
        force,
      ))
    } catch (loadError) {
      noteRateLimit(loadError)
      setProviderStatusError(messageFromError(loadError))
    } finally {
      setProviderStatusLoading(false)
    }
  }, [])

  const loadTab = useCallback(async () => {
    setError('')
    try {
      if (tab === 'questions') {
        const params = { search: search || undefined, category: questionCategory }
        const data = await cachedAdminRequest(
          ['admin-interview-studio', 'questions', params],
          () => listAdminInterviewQuestions(params),
        )
        setQuestions(data.items)
        setQuestionCounts({ HR: data.counts.HR ?? 0, TECHNICAL: data.counts.TECHNICAL ?? 0 })
      } else if (tab === 'tests') {
        const data = await cachedAdminRequest(
          ['admin-interview-studio', 'tests', testCategory],
          () => listAdminInterviewTests(testCategory),
        )
        setTests(data.items)
        setTestCounts({ HR: data.counts.HR ?? 0, TECHNICAL: data.counts.TECHNICAL ?? 0 })
        const questionData = await cachedAdminRequest(
          ['admin-interview-studio', 'test-questions'],
          () => listAdminInterviewQuestions({ active: true, limit: 200 }),
        )
        setQuestions(questionData.items)
        if (!taxonomy) {
          setTaxonomy(await cachedAdminRequest(
            ['admin-interview-studio', 'taxonomy'],
            getAdminInterviewTaxonomy,
          ))
        }
      } else if (tab === 'taxonomy') {
        setTaxonomy(await cachedAdminRequest(
          ['admin-interview-studio', 'taxonomy'],
          getAdminInterviewTaxonomy,
        ))
      } else if (tab === 'settings') {
        setSettings(await cachedAdminRequest(
          ['admin-interview-studio', 'settings'],
          getAdminInterviewSettings,
        ))
        void loadProviderStatus()
      } else if (tab === 'analytics') {
        void loadAnalytics()
        void loadFailures()
      } else {
        const params = { action: auditAction || undefined, limit: 30, offset: 0 }
        const events = await cachedAdminRequest(
          ['admin-interview-studio', 'audit', params],
          () => getAdminInterviewAudit(params),
        )
        setAudit(events)
        setAuditHasMore(events.length === 30)
      }
    } catch (loadError) {
      noteRateLimit(loadError)
      setError(messageFromError(loadError))
    }
  }, [tab, search, taxonomy, questionCategory, testCategory, auditAction, loadAnalytics, loadFailures, loadProviderStatus])

  useEffect(() => {
    void loadTab()
  }, [loadTab, retry])

  const runMutation = async (operation: () => Promise<unknown>, successMessage: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setNotice(successMessage)
      await queryClient.invalidateQueries({ queryKey: ['admin-interview-studio'] })
      await loadTab()
    } catch (mutationError) {
      setError(messageFromError(mutationError))
    } finally {
      setBusy(false)
    }
  }

  const loadMoreAudit = async () => {
    setAuditLoadingMore(true)
    setError('')
    try {
      const events = await getAdminInterviewAudit({
        action: auditAction || undefined,
        limit: 30,
        offset: audit.length,
      })
      setAudit((current) => [...current, ...events])
      setAuditHasMore(events.length === 30)
    } catch (loadError) {
      noteRateLimit(loadError)
      setError(messageFromError(loadError))
    } finally {
      setAuditLoadingMore(false)
    }
  }

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault()
    await runMutation(async () => {
      if (editingQuestion === null) {
        await createAdminInterviewQuestion(questionDraft)
      } else {
        const { seed_key: _seedKey, ...fields } = questionDraft
        await updateAdminInterviewQuestion(editingQuestion, fields)
      }
      setEditingQuestion(null)
      setQuestionDraft(blankQuestion)
    }, editingQuestion === null ? 'Question added as DRAFT-for-review.' : 'Question updated; changed content requires review.')
  }

  const importCsv = async (file?: File) => {
    if (!file) return
    await runMutation(async () => {
      const result = await importAdminInterviewQuestions(await file.text())
      setNotice(`${result.imported} draft question(s) imported.`)
    }, 'CSV import completed.')
  }

  const editQuestion = (question: AdminInterviewQuestion) => {
    setEditingQuestion(question.id)
    setQuestionDraft({
      seed_key: question.seed_key,
      category: question.category,
      prompt: question.prompt,
      hint: question.hint,
      rubric: question.rubric,
    })
  }

  const submitTest = async (event: FormEvent) => {
    event.preventDefault()
    const rawIds = testDraft.question_ids.split(',').map((item) => item.trim())
    const ids = rawIds.map(Number)
    if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      setError('Enter unique, positive question IDs separated by commas.')
      return
    }
    const payload = {
      slug: testDraft.slug,
      title: testDraft.title,
      description: testDraft.description,
      category_id: Number(testDraft.category_id),
      format: testDraft.format,
      default_mode: testDraft.default_mode,
      question_count: ids.length,
      time_limit_seconds: Number(testDraft.time_limit_seconds),
      company_style: testDraft.company_style,
      active: testDraft.active,
      questions: ids.map((question_id) => ({ question_id, skill_tags: [] as string[] })),
    }
    await runMutation(async () => {
      if (editingTest === null) await createAdminInterviewTest(payload)
      else await updateAdminInterviewTest(editingTest, payload)
      setEditingTest(null)
      setTestDraft({
        ...testDraft,
        slug: '',
        title: '',
        description: '',
        question_ids: '',
      })
    }, 'Mock test saved.')
  }

  const editTest = (test: AdminInterviewTest) => {
    setEditingTest(test.id)
    setTestDraft({
      slug: test.slug,
      title: test.title,
      description: test.description,
      category_id: String(test.category_id),
      format: test.format,
      default_mode: test.default_mode,
      question_count: String(test.question_count),
      time_limit_seconds: String(test.time_limit_seconds),
      company_style: test.company_style,
      active: test.active,
      question_ids: test.questions.map((question) => question.id).join(', '),
    })
  }

  const renderQuestions = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <label className="min-w-52 flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="question-search">Search questions
            <input id="question-search" className={inputClass()} placeholder="Prompt or seed key" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className="flex rounded-lg border border-slate-300 p-1 dark:border-slate-700" aria-label="Filter questions by category">
            {categories.map((value) => (
              <button key={value} type="button" onClick={() => setQuestionCategory(value)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${questionCategory === value ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                {value === 'TECHNICAL' ? 'Technical' : 'HR'} ({questionCounts[value] ?? 0})
              </button>
            ))}
          </div>
          <p className="pb-2 text-xs font-medium text-slate-500">{visibleQuestions.length} questions</p>
          <label className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
            Import CSV
            <input aria-label="Import questions CSV" className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} />
          </label>
        </div>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{questionCategory === 'TECHNICAL' ? 'Technical' : 'HR'} questions ({visibleQuestions.length})</h2>
        <DataList
          ariaLabel="Interview question bank"
          rows={visibleQuestions}
          getRowKey={(question) => question.id}
          emptyState="No matching questions."
          columns={[
            {
              key: 'question',
              header: 'Question',
              render: (question) => (
                <div className="max-w-3xl">
                  <p className="font-medium text-slate-900 dark:text-white">{question.prompt}</p>
                  <p className="mt-1 text-xs text-slate-500">{question.seed_key}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'State',
              render: (question) => (
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{question.review_status.replaceAll('_', ' ')}</Badge>
                  <Badge variant={question.active ? 'emerald' : 'slate'}>{question.active ? 'Active' : 'Inactive'}</Badge>
                </div>
              ),
            },
          ]}
          actions={(question) => (
            <>
              <IconButton icon={Pencil} aria-label={`Edit question ${question.id}`} onClick={() => editQuestion(question)} />
              {question.review_status !== 'APPROVED' && (
                <IconButton
                  icon={Check}
                  variant="primary"
                  aria-label={`Approve question ${question.id}`}
                  disabled={busy}
                  onClick={() => void runMutation(() => approveAdminInterviewQuestion(question.id), 'Question approved.')}
                />
              )}
              <IconButton
                icon={Power}
                aria-label={`${question.active ? 'Deactivate' : 'Reactivate'} question ${question.id}`}
                title={`${question.active ? 'Deactivate' : 'Reactivate'} question`}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`${question.active ? 'Deactivate' : 'Reactivate'} this question? Active tests using it will also be deactivated.`)) {
                    void runMutation(() => updateAdminInterviewQuestion(question.id, { active: !question.active }), 'Question status updated.')
                  }
                }}
              />
            </>
          )}
        />
      </section>
      <form className="h-fit space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => void submitQuestion(event)}>
        <h2 className="font-semibold">{editingQuestion === null ? 'Add question' : 'Edit question'}</h2>
        <label className="block text-sm">Seed key<input required disabled={editingQuestion !== null} className={inputClass()} value={questionDraft.seed_key} onChange={(event) => setQuestionDraft({ ...questionDraft, seed_key: event.target.value })} /></label>
        <label className="block text-sm">Category<select className={inputClass()} value={questionDraft.category} onChange={(event) => setQuestionDraft({ ...questionDraft, category: event.target.value })}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">Prompt<textarea required minLength={8} maxLength={3000} className={inputClass()} value={questionDraft.prompt} onChange={(event) => setQuestionDraft({ ...questionDraft, prompt: event.target.value })} /></label>
        <label className="block text-sm">Hint<textarea required minLength={3} maxLength={1500} className={inputClass()} value={questionDraft.hint} onChange={(event) => setQuestionDraft({ ...questionDraft, hint: event.target.value })} /></label>
        <label className="block text-sm">Evaluation rubric<textarea required minLength={5} maxLength={2500} className={inputClass()} value={questionDraft.rubric} onChange={(event) => setQuestionDraft({ ...questionDraft, rubric: event.target.value })} /></label>
        <div className="flex gap-2"><Button disabled={busy} leftIcon={editingQuestion === null ? <Plus className="h-4 w-4" /> : undefined}>{editingQuestion === null ? 'Add draft' : 'Save changes'}</Button>{editingQuestion !== null && <Button type="button" variant="secondary" onClick={() => { setEditingQuestion(null); setQuestionDraft(blankQuestion) }}>Cancel</Button>}</div>
      </form>
    </div>
  )

  const renderTests = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <section className="space-y-3">
        <div className="flex rounded-lg border border-slate-300 p-1 dark:border-slate-700" aria-label="Filter mock tests by category">
          {categories.map((value) => (
            <button key={value} type="button" onClick={() => setTestCategory(value)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${testCategory === value ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              {value === 'TECHNICAL' ? 'Technical' : 'HR'} ({testCounts[value] ?? 0})
            </button>
          ))}
        </div>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{testCategory === 'TECHNICAL' ? 'Technical' : 'HR'} mock tests ({tests.length})</h2>
        <DataList
          ariaLabel="Mock tests"
          rows={tests}
          getRowKey={(test) => test.id}
          emptyState="No mock tests are configured."
          columns={[
            {
              key: 'test',
              header: 'Test',
              render: (test) => (
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{test.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{test.description}</p>
                  {test.company_style && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Public/admin-curated practice; not an official assessment.</p>}
                </div>
              ),
            },
            {
              key: 'format',
              header: 'Format',
              render: (test) => <span className="text-xs">{test.format} · {test.question_count} questions</span>,
            },
            {
              key: 'status',
              header: 'Version · state',
              render: (test) => <div className="flex flex-wrap items-center gap-2"><span>v{test.version}</span><Badge variant={test.active ? 'emerald' : 'slate'}>{test.active ? 'Active' : 'Inactive'}</Badge></div>,
            },
          ]}
          actions={(test) => <IconButton icon={Pencil} aria-label={`Edit mock test ${test.title}`} onClick={() => editTest(test)} />}
        />
      </section>
      <form className="h-fit space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => void submitTest(event)}>
        <h2 className="font-semibold">{editingTest === null ? 'Create mock test' : 'Edit test (content changes create a version)'}</h2>
        <label className="block text-sm">Slug<input required className={inputClass()} value={testDraft.slug} onChange={(event) => setTestDraft({ ...testDraft, slug: event.target.value })} /></label>
        <label className="block text-sm">Title<input required className={inputClass()} value={testDraft.title} onChange={(event) => setTestDraft({ ...testDraft, title: event.target.value })} /></label>
        <label className="block text-sm">Description<textarea required className={inputClass()} value={testDraft.description} onChange={(event) => setTestDraft({ ...testDraft, description: event.target.value })} /></label>
        <label className="block text-sm">Category<select required className={inputClass()} value={testDraft.category_id} onChange={(event) => setTestDraft({ ...testDraft, category_id: event.target.value })}><option value="">Select</option>{taxonomy?.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Format<select className={inputClass()} value={testDraft.format} onChange={(event) => setTestDraft({ ...testDraft, format: event.target.value })}>{['QUICK_PRACTICE', 'STANDARD', 'FULL', 'TOPIC_WISE'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block text-sm">Mode<select className={inputClass()} value={testDraft.default_mode} onChange={(event) => setTestDraft({ ...testDraft, default_mode: event.target.value })}><option>PRACTICE</option><option>ASSESSMENT</option></select></label>
          <label className="block text-sm">Time limit (seconds)<input type="number" min="60" max="7200" className={inputClass()} value={testDraft.time_limit_seconds} onChange={(event) => setTestDraft({ ...testDraft, time_limit_seconds: event.target.value })} /></label>
        </div>
        <label className="block text-sm">Question IDs, comma-separated<input required className={inputClass()} placeholder="1, 2, 3, 4, 5" value={testDraft.question_ids} onChange={(event) => setTestDraft({ ...testDraft, question_ids: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={testDraft.company_style} onChange={(event) => setTestDraft({ ...testDraft, company_style: event.target.checked })} />Company-style practice based on public or admin-curated patterns</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={testDraft.active} onChange={(event) => setTestDraft({ ...testDraft, active: event.target.checked })} />Active</label>
        <p className="text-xs text-slate-500">Question count is derived from the IDs; supported counts are 5, 10, 15, and 20.</p>
        <div className="flex gap-2"><Button disabled={busy}>{editingTest === null ? 'Create test' : 'Save test'}</Button>{editingTest !== null && <Button type="button" variant="secondary" onClick={() => setEditingTest(null)}>Cancel</Button>}</div>
      </form>
    </div>
  )

  const renderTaxonomy = () => (
    <div className="grid gap-5 md:grid-cols-2">
      {categories.map((category) => (
        <article key={category} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h3 className="font-semibold">{category === 'TECHNICAL' ? 'Technical' : 'HR'}</h3>
          <p className="text-sm text-slate-500">{questionCounts[category] ?? 0} questions · {testCounts[category] ?? 0} mock tests</p>
        </article>
      ))}
    </div>
  )

  const renderSettings = () => settings && <form className="max-w-2xl space-y-4 rounded-xl border border-slate-200 p-5 dark:border-slate-800" onSubmit={(event) => {
    event.preventDefault()
    void runMutation(async () => setSettings(await updateAdminInterviewSettings({
      voice_enabled: settings.voice_enabled,
      video_enabled: settings.video_enabled,
      recording_enabled: settings.recording_enabled,
      retention_days: settings.retention_days,
      sessions_per_day: settings.sessions_per_day,
    })), 'Settings updated.')
  }}>
    <h2 className="font-semibold">Operational controls</h2>
    <section aria-label="AI evaluation provider status" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">AI evaluation provider</h3>
        <Badge variant={providerStatus?.configured && !providerStatus.last_error ? 'emerald' : 'amber'}>
          {providerStatusLoading
            ? 'Checking'
            : providerStatusError
              ? 'Status unavailable'
              : providerStatus?.last_error === 'provider_api_key_missing'
                ? 'Provider not configured: add INTERVIEW_LLM_API_KEY'
                : providerStatus?.last_error === 'provider_rate_limited'
                  ? 'Rate limited'
                  : providerStatus?.last_error === 'provider_insufficient_quota'
                    ? 'Quota/billing issue'
                    : providerStatus?.last_error === 'provider_invalid_key'
                      ? 'Invalid API key'
                      : providerStatus?.last_error === 'provider_model_not_found'
                        ? 'Model not found'
                : !providerStatus?.configured
                  ? 'Not configured'
                  : providerStatus.last_error
                    ? 'Unavailable'
                    : 'Healthy'}
        </Badge>
      </div>
      {providerStatus && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{providerStatus.provider} · Active model: {providerStatus.model}</p>}
      {!providerStatusLoading && !providerStatusError && providerStatus && !providerStatus.configured && (
        <p role="status" className="mt-2 text-sm text-amber-800 dark:text-amber-200">{providerStatusMessage(providerStatus.last_error)}</p>
      )}
      {!providerStatusLoading && !providerStatusError && providerStatus?.configured && providerStatus.last_error && (
        <p role="status" className="mt-2 text-sm text-amber-800 dark:text-amber-200">
          {providerStatusMessage(providerStatus.last_error)}
        </p>
      )}
      {providerStatusError && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{providerStatusError}</p>}
      <Button type="button" className="mt-2" size="sm" variant="secondary" disabled={providerStatusLoading || retryWait > 0} onClick={() => void loadProviderStatus(true)}>
        Retry provider check
      </Button>
    </section>
    {(['voice_enabled', 'video_enabled', 'recording_enabled'] as const).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} />{key.replace('_enabled', '').replace('_', ' ')} enabled</label>)}
    <label className="block text-sm">Recording retention (days)<input type="number" min="1" max="365" className={inputClass()} value={settings.retention_days} onChange={(event) => setSettings({ ...settings, retention_days: Number(event.target.value) })} /></label>
    <label className="block text-sm">Sessions per student per day<input type="number" min="1" max="50" className={inputClass()} value={settings.sessions_per_day} onChange={(event) => setSettings({ ...settings, sessions_per_day: Number(event.target.value) })} /></label>
    <div><p className="text-sm font-medium">Allowed provider hosts (environment-managed)</p><p className="text-xs text-slate-500">Only these hosts can receive interview data: {settings.allowed_provider_hosts.join(', ') || 'none configured'}.</p></div>
    <Button disabled={busy}>Save settings</Button>
  </form>

  const renderAnalytics = () => {
    const evaluationFailures = Array.isArray(failures?.evaluations)
      ? failures.evaluations as Array<{ code?: string; count?: number }>
      : []
    const reportFailures = Array.isArray(failures?.reports)
      ? failures.reports as Array<{ code?: string; count?: number }>
      : []
    const providerFailures = Array.isArray(failures?.provider_failures)
      ? failures.provider_failures as Array<{ code?: string; count?: number }>
      : []
    const failureRows = [
      ...evaluationFailures.map((failure) => ({ area: 'Evaluation', reason: failureReasonLabel(failure.code ?? 'evaluation_failed'), count: Number(failure.count ?? 0) })),
      ...reportFailures.map((failure) => ({ area: 'Report', reason: failureReasonLabel(failure.code ?? 'report_failed'), count: Number(failure.count ?? 0) })),
      ...providerFailures.map((failure) => ({ area: 'Provider', reason: failureReasonLabel(failure.code ?? 'provider_failed'), count: Number(failure.count ?? 0) })),
    ]
    const modeCounts = (analytics?.mode_split ?? {}) as Record<string, number>
    const dailyRows = Array.isArray(analytics?.daily)
      ? analytics.daily as Array<{ date?: string; mode?: string; started?: number; completed?: number }>
      : []
    const proctoring = (analytics?.proctoring ?? {}) as {
      violation_count?: number
      types?: Record<string, number>
    }
    const proctoringLabels: Record<string, string> = {
      FULLSCREEN_EXIT: 'Fullscreen exit',
      WINDOW_BLUR: 'Window blur',
      SHORTCUT_ATTEMPT: 'Shortcut attempt',
      TAB_HIDDEN: 'Tab hidden',
      COPY_ATTEMPT: 'Copy attempt',
      PASTE_ATTEMPT: 'Paste attempt',
    }

    return <div className="space-y-5">
      {analyticsError
        ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{analyticsError}<Button className="ml-3" size="sm" variant="secondary" disabled={retryWait > 0} onClick={() => void loadAnalytics(true)}>{retryWait ? `Retry in ${retryWait}s` : 'Retry'}</Button></div>
        : analyticsLoading
          ? <p role="status" className="text-sm text-slate-500">Loading usage data…</p>
          : analytics && <>
            {Number(analytics.sessions_started ?? 0) === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">No usage data yet.</p>}
            <section aria-label="Usage summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Total started', Number(analytics.sessions_started ?? 0)],
                ['Completed', Number(analytics.sessions_completed ?? 0)],
                ['Failed evaluations', failures ? evaluationFailures.reduce((total, item) => total + Number(item.count ?? 0), 0) : '—'],
                ['Proctoring violations', Number(proctoring.violation_count ?? 0)],
              ].map(([label, count]) => <div key={String(label)} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><p className="text-xs text-slate-500">{label}</p><strong className="text-xl">{count}</strong></div>)}
            </section>
            <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="font-semibold">Usage by mode</h2>
              <div className="mt-3 overflow-x-auto">
                <table aria-label="Usage by mode" className="w-full text-left text-sm">
                  <thead><tr className="text-xs text-slate-500"><th className="py-2">Mode</th><th className="py-2">Started</th></tr></thead>
                  <tbody>{[['Text', 'TEXT'], ['Voice', 'VOICE'], ['Video', 'VIDEO']].map(([label, mode]) => <tr key={mode} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2">{label}</td><td className="py-2">{Number(modeCounts[mode] ?? 0)}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="font-semibold">Daily usage</h2>
              {dailyRows.length === 0
                ? <p className="mt-3 text-sm text-slate-500">No data yet.</p>
                : <div className="mt-3 overflow-x-auto"><table aria-label="Daily usage" className="w-full text-left text-sm">
                  <thead><tr className="text-xs text-slate-500"><th className="py-2">Date</th><th className="py-2">Mode</th><th className="py-2">Started</th><th className="py-2">Completed</th></tr></thead>
                  <tbody>{dailyRows.map((row, index) => <tr key={`${row.date}-${row.mode}-${index}`} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2">{usageDateLabel(row.date)}</td><td className="py-2">{String(row.mode ?? '—').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())}</td><td className="py-2">{Number(row.started ?? 0)}</td><td className="py-2">{Number(row.completed ?? 0)}</td></tr>)}</tbody>
                </table></div>}
            </section>
            <section aria-label="Aggregated proctoring events" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <h2 className="font-semibold">Proctoring events</h2>
              {Object.entries(proctoring.types ?? {}).length === 0
                ? <p className="mt-3 text-sm text-slate-500">No data yet.</p>
                : <ul className="mt-3 flex flex-wrap gap-2">{Object.entries(proctoring.types ?? {}).map(([event, count]) => <li key={event} className="rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-slate-800">{proctoringLabels[event] ?? event.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())} {count}</li>)}</ul>}
              <p className="mt-3 text-xs text-slate-500">Aggregated counts only.</p>
            </section>
          </>}
      {failuresError
        ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{failuresError}<Button className="ml-3" size="sm" variant="secondary" disabled={retryWait > 0} onClick={() => void loadFailures(true)}>{retryWait ? `Retry in ${retryWait}s` : 'Retry'}</Button></div>
        : failuresLoading
          ? <p role="status" className="text-sm text-slate-500">Loading failure data…</p>
          : failures && <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Failure monitor</h2>{failureRows.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => {
          if (window.confirm('Retry up to 10 failed evaluations? No student content will be returned.')) {
            void runMutation(async () => {
              const result = await retryAdminInterviewFailures()
              setNotice(`Retry batch: ${result.completed} recovered, ${result.failed} still failed.`)
            }, 'Retry batch completed.')
          }
        }}>Retry evaluation batch</Button>}</div>
        {failureRows.length === 0
          ? <p className="mt-3 text-sm text-slate-500">No data yet.</p>
          : <div className="mt-3 overflow-x-auto"><table aria-label="Failure monitor" className="w-full text-left text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="py-2">Area</th><th className="py-2">Reason</th><th className="py-2">Count</th></tr></thead>
            <tbody>{failureRows.map((failure, index) => <tr key={`${failure.area}-${failure.reason}-${index}`} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2">{failure.area}</td><td className="py-2">{failure.reason}</td><td className="py-2"><Badge variant="rose">{failure.count}</Badge></td></tr>)}</tbody>
          </table></div>}
      </section>}
    </div>
  }

  const renderAudit = () => (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Audit log</h2>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Filter by action
          <select className={inputClass()} value={auditAction} onChange={(event) => setAuditAction(event.target.value)}>
            <option value="">All actions</option>
            {['question_created', 'question_updated', 'question_approved', 'questions_imported', 'test_created', 'test_updated', 'category_created', 'category_updated', 'settings_updated', 'evaluation_retry_batch'].map((action) => (
              <option key={action} value={action}>{auditActionLabel(action)}</option>
            ))}
          </select>
        </label>
      </div>
      {audit.length === 0
        ? <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">{error ? 'Audit log is unavailable.' : 'No changes recorded yet.'}</div>
        : <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:block">
            <table aria-label="Interview Studio audit log" className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <tr>{['When', 'Admin', 'Action', 'Item', 'Change'].map((header) => <th key={header} scope="col" className="px-4 py-3">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {audit.map((entry) => {
                  const id = String(entry.id)
                  const expanded = expandedAuditId === id
                  return (
                    <Fragment key={id}>
                      <tr>
                        <td className="px-4 py-3">{formatAuditDate(entry.created_at)}</td>
                        <td className="px-4 py-3">{typeof entry.actor_name === 'string' && entry.actor_name ? entry.actor_name : `Admin #${String(entry.actor_id ?? 'removed')}`}</td>
                        <td className="px-4 py-3"><Badge variant={auditActionVariant(String(entry.action))}>{auditActionLabel(String(entry.action))}</Badge></td>
                        <td className="px-4 py-3">{`${auditEntityLabel(String(entry.entity_type))}${entry.entity_id ? ` #${String(entry.entity_id)}` : ''}`}</td>
                        <td className="px-4 py-3">
                          <p>{auditChangeSummary(entry.summary)}</p>
                          <button type="button" aria-expanded={expanded} onClick={() => setExpandedAuditId(expanded ? null : id)} className="mt-1 text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Details</button>
                        </td>
                      </tr>
                      {expanded && <tr><td colSpan={5} className="bg-slate-50 px-4 py-3 dark:bg-slate-950"><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry.summary, null, 2)}</pre></td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900 md:hidden">
            {audit.map((entry) => {
              const id = String(entry.id)
              const expanded = expandedAuditId === id
              return (
                <article key={id} className="space-y-3 p-4">
                  <dl className="grid gap-3">
                    <div><dt className="text-[11px] font-semibold uppercase text-slate-500">When</dt><dd>{formatAuditDate(entry.created_at)}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase text-slate-500">Admin</dt><dd>{typeof entry.actor_name === 'string' && entry.actor_name ? entry.actor_name : `Admin #${String(entry.actor_id ?? 'removed')}`}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase text-slate-500">Action</dt><dd><Badge variant={auditActionVariant(String(entry.action))}>{auditActionLabel(String(entry.action))}</Badge></dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase text-slate-500">Item</dt><dd>{`${auditEntityLabel(String(entry.entity_type))}${entry.entity_id ? ` #${String(entry.entity_id)}` : ''}`}</dd></div>
                    <div><dt className="text-[11px] font-semibold uppercase text-slate-500">Change</dt><dd>{auditChangeSummary(entry.summary)}</dd></div>
                  </dl>
                  <button type="button" aria-expanded={expanded} onClick={() => setExpandedAuditId(expanded ? null : id)} className="text-xs font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Details</button>
                  {expanded && <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950">{JSON.stringify(entry.summary, null, 2)}</pre>}
                </article>
              )
            })}
          </div>
        </>}
      {auditHasMore && <Button variant="outline" disabled={auditLoadingMore} isLoading={auditLoadingMore} onClick={() => void loadMoreAudit()}>Load more</Button>}
    </section>
  )

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Admin management</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">AI Interview Studio</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Manage curated questions, versioned tests and operational settings. This console does not expose student answers, transcripts, reports, or recordings.</p>
      </header>
      <nav aria-label="Interview Studio admin sections" className="flex flex-wrap gap-2">
        {tabs.map((item) => <Button key={item.id} size="sm" variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => setTab(item.id)}>{item.label}</Button>)}
        <Button size="sm" variant="secondary" disabled={retryWait > 0} onClick={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin-interview-studio'] })
          setRetry((value) => value + 1)
        }}>{retryWait ? `Refresh in ${retryWait}s` : 'Refresh'}</Button>
      </nav>
      {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}<Button className="ml-3" size="sm" variant="secondary" disabled={retryWait > 0} onClick={() => {
        void queryClient.invalidateQueries({ queryKey: ['admin-interview-studio'] })
        setRetry((value) => value + 1)
      }}>{retryWait ? `Retry in ${retryWait}s` : 'Retry'}</Button></div>}
      {notice && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}
      {tab === 'questions' && renderQuestions()}
      {tab === 'tests' && renderTests()}
      {tab === 'taxonomy' && renderTaxonomy()}
      {tab === 'settings' && renderSettings()}
      {tab === 'analytics' && renderAnalytics()}
      {tab === 'audit' && renderAudit()}
      <div className="sr-only" aria-live="polite">{busy ? 'Saving changes' : ''}</div>
    </main>
  )
}
