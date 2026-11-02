import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'

interface Topic {
  topic: string
  name: string
  description: string
  icon: string
  badge_title: string
  active: boolean
  attempts: number
  pass_rate: number
  average_score: number | null
  active_questions: number
  difficulty_pool_sizes: Record<string, number>
  bank_warnings: string[]
  weakest_subtopics: Array<{ subtopic: string; average_percentage: number; attempts: number }>
  hardest_questions: Array<{ question_id: number; prompt: string; correct_rate: number | null; attempts: number }>
}

interface Attempt {
  id: number
  student_id: number
  student_email: string
  status: string
  score: number | null
  passed: boolean | null
  started_at: string
  submitted_at: string | null
}

interface AttemptDetails extends Attempt {
  level: string | null
  percentile: number | null
  subtopic_scores: Record<string, { percentage: number }>
}

interface AttemptPage {
  items: Attempt[]
  total: number
  page: number
  page_size: number
}

export function AdminSkillTopicsPanel() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedTopic, setSelectedTopic] = useState('')
  const [attempts, setAttempts] = useState<AttemptPage | null>(null)
  const [attemptPage, setAttemptPage] = useState(1)
  const [details, setDetails] = useState<AttemptDetails | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '', icon: '', badge_title: '', active: true })
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [detailRetry, setDetailRetry] = useState(0)

  const loadTopics = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get<Topic[]>('/skills/admin/topics')
      setTopics(response.data)
      setSelectedTopic((current) => current || response.data[0]?.topic || '')
    } catch (requestError) {
      console.error('Unable to load skill topic analytics.', requestError)
      setError('Topic analytics could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTopics()
  }, [])

  const topic = topics.find((item) => item.topic === selectedTopic)

  useEffect(() => {
    if (!selectedTopic) return
    const controller = new AbortController()
    setAttempts(null)
    setDetails(null)
    Promise.all([
      api.get<AttemptPage>(`/skills/admin/topics/${encodeURIComponent(selectedTopic)}/attempts?page=${attemptPage}&page_size=10`, { signal: controller.signal }),
      api.get<Topic>(`/skills/admin/topics/${encodeURIComponent(selectedTopic)}`, { signal: controller.signal }),
    ]).then(([attemptResponse, topicResponse]) => {
      setAttempts(attemptResponse.data)
      setTopics((current) => current.map((item) => item.topic === selectedTopic ? { ...item, ...topicResponse.data } : item))
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        console.error(`Unable to load skill topic ${selectedTopic} details.`, requestError)
        setAttempts({ items: [], total: 0, page: attemptPage, page_size: 10 })
        setError('Topic details could not be loaded.')
      }
    })
    return () => controller.abort()
  }, [selectedTopic, attemptPage, detailRetry])

  const beginEdit = () => {
    if (!topic) return
    setDraft({
      name: topic.name,
      description: topic.description,
      icon: topic.icon,
      badge_title: topic.badge_title,
      active: topic.active,
    })
    setEditing(true)
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!topic) return
    setSaving(true)
    setError('')
    try {
      await api.patch(`/skills/admin/topics/${encodeURIComponent(topic.topic)}`, draft)
      setEditing(false)
      await loadTopics()
    } catch (requestError) {
      console.error(`Unable to update skill topic ${topic.topic}.`, requestError)
      setError('Topic settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const loadAttempt = async (attemptId: number) => {
    setError('')
    try {
      const response = await api.get<AttemptDetails>(`/skills/admin/attempts/${attemptId}`)
      setDetails(response.data)
    } catch (requestError) {
      console.error(`Unable to load skill attempt ${attemptId}.`, requestError)
      setError('Attempt details could not be loaded.')
    }
  }

  return (
    <section aria-labelledby="admin-skill-topics-heading" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="admin-skill-topics-heading" className="text-lg font-bold text-slate-900 dark:text-white">Topic analytics and settings</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review assessment readiness and student attempt results.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadTopics()}>Refresh</Button>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { void loadTopics(); setDetailRetry((value) => value + 1) }}>Retry</Button></div>}
      {loading ? (
        <div aria-label="Loading assessment topics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      ) : topics.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No assessment topics are configured yet.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((item) => (
                <button key={item.topic} type="button" aria-pressed={selectedTopic === item.topic} onClick={() => { setSelectedTopic(item.topic); setAttemptPage(1); setEditing(false) }} className={`rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selectedTopic === item.topic ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-200 bg-white hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-950'}`}>
                  <div className="flex items-start justify-between gap-2"><span className="text-xl" aria-hidden="true">{item.icon}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.active ? 'Active' : 'Inactive'}</span></div>
                  <h3 className="mt-2 font-semibold text-slate-900 dark:text-white">{item.name}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.attempts} attempts · {item.pass_rate}% pass rate</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.active_questions} active questions</p>
                </button>
              ))}
            </div>

            {topic && (
              <article aria-label={`${topic.name} analytics`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="font-bold text-slate-900 dark:text-white">{topic.name}</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{topic.description}</p></div>
                  <Button variant="outline" size="sm" onClick={beginEdit}>Edit topic</Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-xs text-slate-500">Attempts</p><p className="font-semibold">{topic.attempts}</p></div>
                  <div><p className="text-xs text-slate-500">Pass rate</p><p className="font-semibold">{topic.pass_rate}%</p></div>
                  <div><p className="text-xs text-slate-500">Average score</p><p className="font-semibold">{topic.average_score == null ? '—' : `${topic.average_score}%`}</p></div>
                  <div><p className="text-xs text-slate-500">Question pool</p><p className="font-semibold">{Object.entries(topic.difficulty_pool_sizes).map(([key, count]) => `${key} ${count}`).join(' · ')}</p></div>
                </div>
                {topic.bank_warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">{topic.bank_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div><h4 className="text-xs font-semibold uppercase text-slate-500">Weakest subtopics</h4>{topic.weakest_subtopics.length ? <ul className="mt-2 space-y-1 text-xs">{topic.weakest_subtopics.map((item) => <li key={item.subtopic} className="flex justify-between gap-2"><span>{item.subtopic}</span><span>{item.average_percentage}% · {item.attempts} attempts</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No subtopic results yet.</p>}</div>
                  <div><h4 className="text-xs font-semibold uppercase text-slate-500">Hardest questions</h4>{topic.hardest_questions.length ? <ul className="mt-2 space-y-1 text-xs">{topic.hardest_questions.slice(0, 3).map((item) => <li key={item.question_id} className="flex justify-between gap-2"><span className="line-clamp-1">{item.prompt}</span><span>{item.correct_rate == null ? 'No data' : `${item.correct_rate}%`}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No question results yet.</p>}</div>
                </div>
              </article>
            )}
          </div>

          <aside className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            {editing && topic ? (
              <form onSubmit={(event) => void save(event)} className="space-y-3">
                <h3 className="font-semibold text-slate-900 dark:text-white">Edit topic settings</h3>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Display name<input required maxLength={150} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Description<textarea maxLength={2000} rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Icon / symbol<input required maxLength={80} value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Badge title<input required maxLength={255} value={draft.badge_title} onChange={(event) => setDraft((current) => ({ ...current, badge_title: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} />Topic active</label>
                <div className="flex gap-2"><Button type="submit" variant="primary" size="sm" isLoading={saving}>Save settings</Button><Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">Recent attempts</h3><span className="text-xs text-slate-500">{attempts?.total ?? 0} total</span></div>
                {!attempts ? <p role="status" className="mt-4 text-sm text-slate-500">Loading attempt history…</p> : attempts.items.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">No students have attempted this topic.</p> : (
                  <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
                    {attempts.items.map((attempt) => <li key={attempt.id} className="flex items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{attempt.student_email}</p><p className="text-xs text-slate-500">{attempt.status} · {attempt.score == null ? '—' : `${attempt.score}%`}</p></div><Button size="sm" variant="outline" onClick={() => void loadAttempt(attempt.id)}>View</Button></li>)}
                  </ul>
                )}
                {attempts && attempts.total > attempts.page_size && <nav aria-label="Skill attempt pages" className="mt-3 flex items-center justify-between"><Button size="sm" variant="outline" disabled={attempts.page <= 1} onClick={() => setAttemptPage((page) => page - 1)}>Previous</Button><span className="text-xs text-slate-500">Page {attempts.page} of {Math.ceil(attempts.total / attempts.page_size)}</span><Button size="sm" variant="outline" disabled={attempts.page >= Math.ceil(attempts.total / attempts.page_size)} onClick={() => setAttemptPage((page) => page + 1)}>Next</Button></nav>}
                {details && <div role="dialog" aria-label="Assessment attempt details" className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm dark:bg-indigo-950/30"><div className="flex items-center justify-between"><h4 className="font-semibold">Attempt #{details.id}</h4><Button size="sm" variant="ghost" aria-label="Close attempt details" onClick={() => setDetails(null)}>Close</Button></div><p className="mt-2">{details.student_email} · {details.passed ? 'Passed' : details.passed === false ? 'Not passed' : details.status}</p><p className="text-xs text-slate-600 dark:text-slate-300">Score {details.score ?? '—'}% · {details.level ?? 'No level'} · Percentile {details.percentile ?? '—'}</p><ul className="mt-2 space-y-1 text-xs">{Object.entries(details.subtopic_scores).map(([key, value]) => <li key={key} className="flex justify-between"><span>{key}</span><span>{value.percentage}%</span></li>)}</ul></div>}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
