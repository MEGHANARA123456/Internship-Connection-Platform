import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardContent } from '../../components/ui/Card'
import { DataList } from '../../components/ui/DataList'
import { IconButton } from '../../components/ui/IconButton'
import { InterviewErrorNotice, useInterviewError } from './InterviewErrorNotice'
import { routes } from '../../lib/routes'
import {
  createMockTestAttempt,
  getMockTest,
  getMockTestRecommendation,
  listMockTests,
  startInterviewSession,
} from '../../services/interviewService'
import type {
  InterviewMode,
  InterviewSessionType,
  MockTest,
  MockTestDetail,
  MockTestFormat,
  MockTestRecommendation,
} from '../../types/interview'

const formatLabels: Record<MockTestFormat, string> = {
  QUICK_PRACTICE: 'Quick Practice',
  STANDARD: 'Standard',
  FULL: 'Full',
  TOPIC_WISE: 'Topic-Wise',
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function MockTestsLibrary() {
  const navigate = useNavigate()
  const requestError = useInterviewError()
  const [tests, setTests] = useState<MockTest[]>([])
  const [recommendation, setRecommendation] = useState<MockTestRecommendation | null>(null)
  const [selected, setSelected] = useState<MockTestDetail | null>(null)
  const [category, setCategory] = useState<'HR' | 'TECHNICAL'>('HR')
  const [format, setFormat] = useState<MockTestFormat | ''>('')
  const [sessionType, setSessionType] = useState<InterviewSessionType>('PRACTICE')
  const [interviewMode, setInterviewMode] = useState<InterviewMode>('TEXT')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [createdSessionId, setCreatedSessionId] = useState<number | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const filters = {
        category,
        ...(format ? { format } : {}),
      }
      const [catalog, nextRecommendation] = await Promise.all([
        listMockTests(filters),
        getMockTestRecommendation(),
      ])
      setTests(catalog)
      setRecommendation(nextRecommendation)
    } catch (loadError) {
      setError(requestError(loadError, routes.interviewStudio))
    } finally {
      setLoading(false)
    }
  }, [category, format, requestError])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const openTest = async (testId: number) => {
    setError('')
    try {
      const detail = await getMockTest(testId)
      setSelected(detail)
      setSessionType(detail.default_mode)
      setConsent(false)
      setCreatedSessionId(null)
    } catch (loadError) {
      setError(requestError(loadError, routes.interviewStudio))
    }
  }

  const startTest = async () => {
    if (!selected || !consent || starting) return
    setStarting(true)
    setError('')
    setCreatedSessionId(null)
    try {
      const session = await createMockTestAttempt(selected.id, {
        session_type: sessionType,
        interview_mode: interviewMode,
        consent_acknowledged: true,
      })
      setCreatedSessionId(session.id)
      await startInterviewSession(session.id)
      navigate(routes.interviewSession(session.id))
    } catch (startError) {
      setError(requestError(startError, routes.interviewStudio))
    } finally {
      setStarting(false)
      void loadCatalog()
    }
  }

  const recommendedTest = recommendation?.recommended_test

  return (
    <div className="space-y-5">
      {error && <InterviewErrorNotice message={error} onRetry={() => void loadCatalog()} retrying={loading} />}
      {createdSessionId !== null && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Your test attempt was created but could not be started. <button className="font-semibold underline" onClick={() => navigate(routes.interviewSession(createdSessionId))}>Continue to attempt</button>.
        </div>
      )}

      {recommendedTest && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Recommended next test</p>
              <h3 className="mt-1 font-semibold text-slate-900 dark:text-white">{recommendedTest.title}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Based on your latest report's focus area: {titleCase(recommendation?.weakest_skill ?? '')}.</p>
            </div>
            <Button variant="outline" onClick={() => void openTest(recommendedTest.id)}>View recommendation</Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-300 p-1 dark:border-slate-700" aria-label="Filter mock tests by category">
          {(['HR', 'TECHNICAL'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setCategory(value)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${category === value ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
              {value === 'TECHNICAL' ? 'Technical' : 'HR'}
            </button>
          ))}
        </div>
        <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          Format
          <select aria-label="Filter by format" value={format} onChange={(event) => setFormat(event.target.value as MockTestFormat | '')} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            <option value="">All formats</option>
            {Object.entries(formatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{category === 'TECHNICAL' ? 'Technical' : 'HR'} mock tests ({tests.length})</h2>
      <DataList
        ariaLabel="Mock tests"
        rows={tests}
        getRowKey={(test) => test.id}
        loading={loading}
        emptyState="No active mock tests match these filters."
        columns={[
          {
            key: 'test',
            header: 'Test',
            render: (test) => (
              <div className="max-w-2xl">
                <p className="font-semibold text-slate-900 dark:text-white">{test.title}</p>
                <p className="mt-1 text-xs text-slate-500">{test.description}</p>
                {test.company_style && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Public/admin-curated practice; not an official company assessment.</p>}
              </div>
            ),
          },
          {
            key: 'details',
            header: 'Format',
            render: (test) => <span>{formatLabels[test.format]}</span>,
          },
          {
            key: 'questions',
            header: 'Length · mode',
            render: (test) => <span>{test.question_count} questions · ~{test.estimated_duration_minutes} min · {titleCase(test.default_mode)}</span>,
          },
          {
            key: 'attempts',
            header: 'Attempts',
            render: (test) => (
              <div className="flex flex-wrap items-center gap-2">
                <span>{test.attempt_count} total · {test.completed_attempt_count} completed{test.latest_score !== null ? ` · Latest ${test.latest_score}/100` : ''}</span>
                {test.completed_attempt_count > 0 && <Badge variant="emerald">Completed</Badge>}
              </div>
            ),
          },
        ]}
        actions={(test) => <IconButton icon={Eye} variant="primary" aria-label={`View ${test.title} details`} onClick={() => void openTest(test.id)} />}
      />

      {selected && (
        <Card aria-labelledby="mock-test-detail-title">
          <CardContent className="space-y-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="mock-test-detail-title" className="text-lg font-semibold text-slate-900 dark:text-white">{selected.title}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Version {selected.version} · {selected.question_count} questions · ~{selected.estimated_duration_minutes} minutes</p>
              </div>
              <Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button>
            </div>

            <div>
              <p className="text-sm text-slate-600 dark:text-slate-300">{selected.description}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Questions are revealed during the interview.</p>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); void startTest() }} className="space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">Start a new attempt</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Practice type
                  <select aria-label="Practice type" value={sessionType} onChange={(event) => setSessionType(event.target.value as InterviewSessionType)} disabled={starting} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
                    <option value="PRACTICE">Practice with immediate coaching</option>
                    <option value="ASSESSMENT">Assessment; feedback after completion</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
                  Interview mode
                  <select aria-label="Interview mode" value={interviewMode} onChange={(event) => setInterviewMode(event.target.value as InterviewMode)} disabled={starting} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
                    <option value="TEXT">Text</option><option value="VOICE">Voice</option><option value="VIDEO">Video</option>
                  </select>
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required className="mt-1" />
                <span>I understand my interview answers are sent to an external AI provider for evaluation. Voice transcription and optional video recording follow their separate consent prompts.</span>
              </label>
              <Button type="submit" disabled={!consent || starting} isLoading={starting}>Start mock test</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
