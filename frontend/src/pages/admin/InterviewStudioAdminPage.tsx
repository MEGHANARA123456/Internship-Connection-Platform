import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import {
  approveAdminInterviewQuestion,
  createAdminInterviewCategory,
  createAdminInterviewQuestion,
  createAdminInterviewTest,
  getAdminInterviewAnalytics,
  getAdminInterviewAudit,
  getAdminInterviewFailures,
  getAdminInterviewSettings,
  getAdminInterviewTaxonomy,
  importAdminInterviewQuestions,
  listAdminInterviewQuestions,
  listAdminInterviewTests,
  retryAdminInterviewFailures,
  updateAdminInterviewCategory,
  updateAdminInterviewDifficulty,
  updateAdminInterviewQuestion,
  updateAdminInterviewSettings,
  updateAdminInterviewTest,
  type AdminInterviewQuestion,
  type AdminInterviewSettings,
  type AdminInterviewTest,
} from '../../services/interviewStudioAdminService'

type Tab = 'questions' | 'tests' | 'taxonomy' | 'settings' | 'analytics' | 'audit'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'questions', label: 'Question bank' },
  { id: 'tests', label: 'Mock tests' },
  { id: 'taxonomy', label: 'Categories & difficulty' },
  { id: 'settings', label: 'Settings' },
  { id: 'analytics', label: 'Usage & failures' },
  { id: 'audit', label: 'Audit log' },
]
const categories = ['HR', 'TECHNICAL', 'DATA_SCIENCE', 'BEHAVIORAL'] as const
const difficulties = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const

function messageFromError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') return response.data.detail
  }
  return error instanceof Error ? error.message : 'The request failed. Please retry.'
}

function inputClass() {
  return 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white'
}

const blankQuestion = {
  seed_key: '',
  category: 'TECHNICAL',
  difficulty: 'BEGINNER',
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
  const [questions, setQuestions] = useState<AdminInterviewQuestion[]>([])
  const [questionDraft, setQuestionDraft] = useState(blankQuestion)
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [tests, setTests] = useState<AdminInterviewTest[]>([])
  const [testDraft, setTestDraft] = useState({
    slug: '',
    title: '',
    description: '',
    category_id: '',
    difficulty: 'BEGINNER',
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
  const [categoryDraft, setCategoryDraft] = useState({ slug: '', label: '' })
  const [settings, setSettings] = useState<AdminInterviewSettings | null>(null)
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null)
  const [failures, setFailures] = useState<Record<string, unknown> | null>(null)
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([])

  const loadTab = useCallback(async () => {
    setError('')
    try {
      if (tab === 'questions') {
        const data = await listAdminInterviewQuestions({ search: search || undefined })
        setQuestions(data.items)
      } else if (tab === 'tests') {
        setTests(await listAdminInterviewTests())
        setQuestions((await listAdminInterviewQuestions({ active: true, limit: 200 })).items)
        if (!taxonomy) setTaxonomy(await getAdminInterviewTaxonomy())
      } else if (tab === 'taxonomy') {
        setTaxonomy(await getAdminInterviewTaxonomy())
      } else if (tab === 'settings') {
        setSettings(await getAdminInterviewSettings())
      } else if (tab === 'analytics') {
        const [usage, failed] = await Promise.all([
          getAdminInterviewAnalytics(),
          getAdminInterviewFailures(),
        ])
        setAnalytics(usage)
        setFailures(failed)
      } else {
        setAudit(await getAdminInterviewAudit())
      }
    } catch (loadError) {
      setError(messageFromError(loadError))
    }
  }, [tab, search, taxonomy])

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
      await loadTab()
    } catch (mutationError) {
      setError(messageFromError(mutationError))
    } finally {
      setBusy(false)
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
      difficulty: question.difficulty,
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
      difficulty: testDraft.difficulty,
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
      difficulty: test.difficulty,
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
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="question-search">Search questions</label>
          <input id="question-search" className={inputClass()} placeholder="Search bank" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">
            Import CSV
            <input aria-label="Import questions CSV" className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event.target.files?.[0])} />
          </label>
        </div>
        <div className="space-y-3">
          {questions.map((question) => (
            <article key={question.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{question.category} · {question.difficulty}</strong>
                <span className="text-xs">{question.review_status} · {question.active ? 'Active' : 'Inactive'}</span>
              </div>
              <p className="mt-2 text-sm">{question.prompt}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => editQuestion(question)}>Edit</Button>
                {question.review_status !== 'APPROVED' && <Button size="sm" onClick={() => void runMutation(() => approveAdminInterviewQuestion(question.id), 'Question approved.')}>Approve</Button>}
                <Button size="sm" variant="secondary" onClick={() => {
                  if (window.confirm(`${question.active ? 'Deactivate' : 'Reactivate'} this question? Active tests using it will also be deactivated.`)) {
                    void runMutation(() => updateAdminInterviewQuestion(question.id, { active: !question.active }), 'Question status updated.')
                  }
                }}>{question.active ? 'Deactivate' : 'Reactivate'}</Button>
              </div>
            </article>
          ))}
          {!questions.length && <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">No matching questions.</p>}
        </div>
      </section>
      <form className="h-fit space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => void submitQuestion(event)}>
        <h2 className="font-semibold">{editingQuestion === null ? 'Add question' : 'Edit question'}</h2>
        <label className="block text-sm">Seed key<input required disabled={editingQuestion !== null} className={inputClass()} value={questionDraft.seed_key} onChange={(event) => setQuestionDraft({ ...questionDraft, seed_key: event.target.value })} /></label>
        <label className="block text-sm">Category<select className={inputClass()} value={questionDraft.category} onChange={(event) => setQuestionDraft({ ...questionDraft, category: event.target.value })}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">Difficulty<select className={inputClass()} value={questionDraft.difficulty} onChange={(event) => setQuestionDraft({ ...questionDraft, difficulty: event.target.value })}>{difficulties.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">Prompt<textarea required minLength={8} maxLength={3000} className={inputClass()} value={questionDraft.prompt} onChange={(event) => setQuestionDraft({ ...questionDraft, prompt: event.target.value })} /></label>
        <label className="block text-sm">Hint<textarea required minLength={3} maxLength={1500} className={inputClass()} value={questionDraft.hint} onChange={(event) => setQuestionDraft({ ...questionDraft, hint: event.target.value })} /></label>
        <label className="block text-sm">Evaluation rubric<textarea required minLength={5} maxLength={2500} className={inputClass()} value={questionDraft.rubric} onChange={(event) => setQuestionDraft({ ...questionDraft, rubric: event.target.value })} /></label>
        <div className="flex gap-2"><Button disabled={busy}>{editingQuestion === null ? 'Add draft' : 'Save changes'}</Button>{editingQuestion !== null && <Button type="button" variant="secondary" onClick={() => { setEditingQuestion(null); setQuestionDraft(blankQuestion) }}>Cancel</Button>}</div>
      </form>
    </div>
  )

  const renderTests = () => (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div className="space-y-3">
        {tests.map((test) => <article key={test.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex flex-wrap justify-between gap-2"><strong>{test.title}</strong><span>v{test.version} · {test.active ? 'Active' : 'Inactive'}</span></div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{test.category} · {test.difficulty} · {test.format} · {test.question_count} questions</p>
          {test.company_style && <p className="mt-1 text-xs text-amber-700">Practice based on public or admin-curated patterns; not an official assessment.</p>}
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => editTest(test)}>Edit / assign questions</Button>
        </article>)}
      </div>
      <form className="h-fit space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => void submitTest(event)}>
        <h2 className="font-semibold">{editingTest === null ? 'Create mock test' : 'Edit test (content changes create a version)'}</h2>
        <label className="block text-sm">Slug<input required className={inputClass()} value={testDraft.slug} onChange={(event) => setTestDraft({ ...testDraft, slug: event.target.value })} /></label>
        <label className="block text-sm">Title<input required className={inputClass()} value={testDraft.title} onChange={(event) => setTestDraft({ ...testDraft, title: event.target.value })} /></label>
        <label className="block text-sm">Description<textarea required className={inputClass()} value={testDraft.description} onChange={(event) => setTestDraft({ ...testDraft, description: event.target.value })} /></label>
        <label className="block text-sm">Category<select required className={inputClass()} value={testDraft.category_id} onChange={(event) => setTestDraft({ ...testDraft, category_id: event.target.value })}><option value="">Select</option>{taxonomy?.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Difficulty<select className={inputClass()} value={testDraft.difficulty} onChange={(event) => setTestDraft({ ...testDraft, difficulty: event.target.value })}>{difficulties.map((value) => <option key={value}>{value}</option>)}</select></label>
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
      <form className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => {
        event.preventDefault()
        void runMutation(async () => {
          await createAdminInterviewCategory(categoryDraft)
          setCategoryDraft({ slug: '', label: '' })
        }, 'Category created.')
      }}>
        <strong>Add category</strong>
        <label className="block text-sm">Stable slug<input required pattern="[a-z0-9-]+" minLength={2} maxLength={50} className={inputClass()} value={categoryDraft.slug} onChange={(event) => setCategoryDraft({ ...categoryDraft, slug: event.target.value })} /></label>
        <label className="block text-sm">Label<input required minLength={2} maxLength={100} className={inputClass()} value={categoryDraft.label} onChange={(event) => setCategoryDraft({ ...categoryDraft, label: event.target.value })} /></label>
        <Button size="sm" disabled={busy}>Create category</Button>
      </form>
      {taxonomy?.categories.map((item) => <form key={item.id} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => {
        event.preventDefault()
        void runMutation(() => updateAdminInterviewCategory(item.id, item), 'Category updated.')
      }}>
        <strong>{item.slug}</strong><label className="block text-sm">Label<input className={inputClass()} value={item.label} onChange={(event) => setTaxonomy((current) => current && ({ ...current, categories: current.categories.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row) }))} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.active} onChange={(event) => setTaxonomy((current) => current && ({ ...current, categories: current.categories.map((row) => row.id === item.id ? { ...row, active: event.target.checked } : row) }))} />Active</label>
        <Button size="sm">Save category</Button>
      </form>)}
      {taxonomy?.difficulties.map((item) => <form key={item.code} className="space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800" onSubmit={(event) => {
        event.preventDefault()
        void runMutation(() => updateAdminInterviewDifficulty(item.code, item), 'Difficulty label updated.')
      }}>
        <strong>{item.code}</strong><label className="block text-sm">Label<input className={inputClass()} value={item.label} onChange={(event) => setTaxonomy((current) => current && ({ ...current, difficulties: current.difficulties.map((row) => row.code === item.code ? { ...row, label: event.target.value } : row) }))} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.active} onChange={(event) => setTaxonomy((current) => current && ({ ...current, difficulties: current.difficulties.map((row) => row.code === item.code ? { ...row, active: event.target.checked } : row) }))} />Active</label>
        <Button size="sm">Save difficulty</Button>
      </form>)}
      <p className="text-sm text-slate-500">Category and difficulty codes are stable identifiers; labels can be edited. Deactivated values are excluded from new student test catalogs.</p>
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
    {(['voice_enabled', 'video_enabled', 'recording_enabled'] as const).map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} />{key.replace('_enabled', '').replace('_', ' ')} enabled</label>)}
    <label className="block text-sm">Recording retention (days)<input type="number" min="1" max="365" className={inputClass()} value={settings.retention_days} onChange={(event) => setSettings({ ...settings, retention_days: Number(event.target.value) })} /></label>
    <label className="block text-sm">Sessions per student per day<input type="number" min="1" max="50" className={inputClass()} value={settings.sessions_per_day} onChange={(event) => setSettings({ ...settings, sessions_per_day: Number(event.target.value) })} /></label>
    <div><p className="text-sm font-medium">Allowed provider hosts (environment-managed)</p><p className="text-xs text-slate-500">Only these hosts can receive interview data: {settings.allowed_provider_hosts.join(', ') || 'none configured'}.</p></div>
    <Button disabled={busy}>Save settings</Button>
  </form>

  const renderAnalytics = () => (
    <div className="space-y-5">
      {analytics && <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {['sessions_started', 'sessions_completed', 'completion_rate', 'evaluation_failure_rate', 'stt_failure_rate', 'average_latency_ms', 'token_total', 'audio_minutes', 'storage_bytes'].map((key) => <div key={key} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><p className="text-xs text-slate-500">{key.replaceAll('_', ' ')}</p><strong>{String(analytics[key] ?? 0)}</strong></div>)}
        <pre className="overflow-auto rounded-xl border p-4 text-xs sm:col-span-2">{JSON.stringify(analytics.mode_split ?? {}, null, 2)}</pre>
        <pre className="overflow-auto rounded-xl border p-4 text-xs sm:col-span-2">{JSON.stringify(analytics.daily ?? [], null, 2)}</pre>
      </section>}
      {failures && <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Sanitized failure monitor</h2><Button variant="secondary" disabled={busy} onClick={() => {
          if (window.confirm('Retry up to 10 failed evaluations? No student content will be returned.')) {
            void runMutation(async () => {
              const result = await retryAdminInterviewFailures()
              setNotice(`Retry batch: ${result.completed} recovered, ${result.failed} still failed.`)
            }, 'Retry batch completed.')
          }
        }}>Retry evaluation batch</Button></div>
        <pre className="mt-3 overflow-auto text-xs">{JSON.stringify(failures, null, 2)}</pre>
      </section>}
    </div>
  )

  const renderAudit = () => <div className="space-y-3">
    {audit.map((entry) => <article key={String(entry.id)} className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
      <div className="flex flex-wrap justify-between gap-2"><strong>{String(entry.action)} · {String(entry.entity_type)}</strong><time>{String(entry.created_at)}</time></div>
      <p className="text-xs text-slate-500">Admin actor ID: {String(entry.actor_id ?? 'removed')} · Entity: {String(entry.entity_id ?? 'global')}</p>
      <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(entry.summary, null, 2)}</pre>
    </article>)}
    {!audit.length && <p className="text-sm text-slate-500">No changes recorded yet.</p>}
  </div>

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Admin management</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">AI Interview Studio</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Manage curated questions, versioned tests and operational settings. This console does not expose student answers, transcripts, reports, or recordings.</p>
      </header>
      <nav aria-label="Interview Studio admin sections" className="flex flex-wrap gap-2">
        {tabs.map((item) => <Button key={item.id} size="sm" variant={tab === item.id ? 'primary' : 'secondary'} onClick={() => setTab(item.id)}>{item.label}</Button>)}
        <Button size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>Refresh</Button>
      </nav>
      {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}<Button className="ml-3" size="sm" variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>}
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
