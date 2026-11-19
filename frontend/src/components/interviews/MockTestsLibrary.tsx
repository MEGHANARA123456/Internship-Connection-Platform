import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Card, CardContent } from '../../components/ui/Card'
import { DataList } from '../../components/ui/DataList'
import { IconButton } from '../../components/ui/IconButton'
import { InterviewErrorNotice, useInterviewError } from './InterviewErrorNotice'
import { routes } from '../../lib/routes'
import {
  compareMockTestAttempts,
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
  MockTestAttempt,
  MockTestComparison,
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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function MockTestsLibrary() {
  const navigate = useNavigate()
  const requestError = useInterviewError()
  const [tests, setTests] = useState<MockTest[]>([])
  const [recommendation, setRecommendation] = useState<MockTestRecommendation | null>(null)
  const [selected, setSelected] = useState<MockTest | null>(null)
  const [comparison, setComparison] = useState<MockTestComparison | null>(null)
  const [selectedAttemptIds, setSelectedAttemptIds] = useState<number[]>([])
  const [category, setCategory] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [format, setFormat] = useState<MockTestFormat | ''>('')
  const [sessionType, setSessionType] = useState<InterviewSessionType>('PRACTICE')
  const [interviewMode, setInterviewMode] = useState<InterviewMode>('TEXT')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState('')
  const [createdSessionId, setCreatedSessionId] = useState<number | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const filters = {
        ...(category ? { category } : {}),
        ...(difficulty ? { difficulty } : {}),
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
  }, [category, difficulty, format, requestError])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const openTest = async (testId: number) => {
    setError('')
    setSelectedAttemptIds([])
    setComparison(null)
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

  const startTest = async (retakeOfSessionId?: number) => {
    if (!selected || !consent || starting) return
    setStarting(true)
    setError('')
    setCreatedSessionId(null)
    try {
      const session = await createMockTestAttempt(selected.id, {
        session_type: sessionType,
        interview_mode: interviewMode,
        consent_acknowledged: true,
        ...(retakeOfSessionId ? { retake_of_session_id: retakeOfSessionId } : {}),
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

  const openComparison = async () => {
    if (!selected || selectedAttemptIds.length < 2) return
    setComparing(true)
    setError('')
    try {
      setComparison(await compareMockTestAttempts(selected.id, selectedAttemptIds))
    } catch (compareError) {
      setError(requestError(compareError, routes.interviewStudio))
    } finally {
      setComparing(false)
    }
  }

  const toggleAttempt = (attempt: MockTestAttempt) => {
    setSelectedAttemptIds((current) => {
      if (current.includes(attempt.session_id)) {
        return current.filter((id) => id !== attempt.session_id)
      }
      const selectedVersion = selected?.attempts.find(
        (item) => current.includes(item.session_id),
      )?.test_version
      if (selectedVersion !== undefined && selectedVersion !== attempt.test_version) {
        return current
      }
      return [...current, attempt.session_id]
    })
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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          Category
          <select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            <option value="">All categories</option>
            {['HR', 'TECHNICAL', 'DATA_SCIENCE', 'DATA_ANALYST', 'BEHAVIORAL'].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          Difficulty
          <select aria-label="Filter by difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            <option value="">All difficulties</option>
            {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          Format
          <select aria-label="Filter by format" value={format} onChange={(event) => setFormat(event.target.value as MockTestFormat | '')} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            <option value="">All formats</option>
            {Object.entries(formatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Mock tests ({tests.length})</h2>
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
            header: 'Format · level',
            render: (test) => <span>{formatLabels[test.format]} · {titleCase(test.category)} · {titleCase(test.difficulty)}</span>,
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
        actions={(test) => <IconButton icon={Eye} variant="primary" aria-label={`View ${test.title} details and attempts`} onClick={() => void openTest(test.id)} />}
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
              <h3 className="font-semibold text-slate-900 dark:text-white">Question set</h3>
              <ol className="mt-2 list-inside list-decimal space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {(selected.questions ?? []).map((question) => (
                  <li key={question.position}>{question.prompt} <span className="text-xs text-slate-500">({question.skill_tags.map(titleCase).join(', ')})</span></li>
                ))}
              </ol>
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

            <section aria-labelledby="mock-test-attempts-title" className="space-y-3">
              <h3 id="mock-test-attempts-title" className="font-semibold text-slate-900 dark:text-white">Your attempts</h3>
              <DataList
                ariaLabel="Mock test attempts"
                rows={selected.attempts}
                getRowKey={(attempt) => attempt.session_id}
                emptyState="No attempts for this test yet."
                columns={[
                  {
                    key: 'attempt',
                    header: 'Attempt',
                    render: (attempt) => (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedAttemptIds.includes(attempt.session_id)}
                          disabled={attempt.status !== 'COMPLETED' || attempt.overall_score === null || (
                            selectedAttemptIds.length > 0
                            && !selectedAttemptIds.includes(attempt.session_id)
                            && selected.attempts.find((item) => selectedAttemptIds.includes(item.session_id))?.test_version !== attempt.test_version
                          )}
                          onChange={() => toggleAttempt(attempt)}
                        />
                        <span>{formatDate(attempt.created_at)} · {attempt.status.replaceAll('_', ' ')} · v{attempt.test_version}</span>
                      </label>
                    ),
                  },
                  { key: 'score', header: 'Score', render: (attempt) => attempt.overall_score === null ? '—' : `${attempt.overall_score}/100` },
                ]}
                actions={(attempt) => (
                  <IconButton
                    icon={RotateCcw}
                    aria-label={`Retake attempt ${attempt.session_id}`}
                    disabled={!consent || starting}
                    onClick={() => void startTest(attempt.session_id)}
                  />
                )}
              />
              {selectedAttemptIds.length > 0 && <p className="text-xs text-slate-500">Comparisons are limited to attempts from the same test version.</p>}
              <Button variant="outline" disabled={selectedAttemptIds.length < 2 || comparing} isLoading={comparing} onClick={() => void openComparison()}>
                Compare selected attempts
              </Button>
            </section>

            {comparison && (
              <section aria-label="Attempt comparison" className="space-y-2">
                <h3 className="mb-2 font-semibold text-slate-900 dark:text-white">Comparison · test version {comparison.test_version}</h3>
                <DataList
                  ariaLabel="Attempt comparison"
                  rows={comparison.attempts}
                  getRowKey={(attempt) => attempt.session_id}
                  columns={[
                    { key: 'attempt', header: 'Attempt', render: (attempt) => `#${attempt.session_id} · ${formatDate(attempt.created_at)}` },
                    { key: 'score', header: 'Score', render: (attempt) => `${attempt.overall_score ?? '—'}/100` },
                    { key: 'skills', header: 'Skill scores', render: (attempt) => Object.entries(attempt.skill_breakdown ?? {}).map(([skill, score]) => `${titleCase(skill)} ${score}`).join(' · ') || 'No skill scores available' },
                  ]}
                />
              </section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
