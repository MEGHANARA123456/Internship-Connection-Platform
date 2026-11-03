import { useEffect, useRef, useState } from 'react'
import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { DropdownSelect } from '../../components/ui/DropdownSelect'
import { Modal } from '../../components/ui/Modal'

interface Topic {
  topic: string
  name: string
  description: string
  icon: string
  badge_title: string
  active: boolean
  archived_at: string | null
  archived_by: number | null
  attempts: number
  attempt_status_counts: { completed: number; expired: number; in_progress: number }
  pass_rate: number
  average_score: number | null
  score_sample_size: number
  analytics_ready: boolean
  active_questions: number
  difficulty_pool_sizes: Record<string, number>
  question_pool_sizes: Record<string, { active: number; inactive: number }>
  bank_warnings: string[]
  weakest_subtopics: Array<{ subtopic: string; average_percentage: number; attempts: number }>
  hardest_questions: Array<{ question_id: number; prompt: string; correct_rate: number | null; attempts: number }>
}

interface Attempt {
  id: number
  student_id: number
  student_email: string
  topic: string
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
  filtered_total: number
  page: number
  page_size: number
}

type AttemptFilter = 'ALL' | 'COMPLETED' | 'EXPIRED' | 'IN_PROGRESS'

interface AdminSkillTopicsPanelProps {
  selectedTopic?: string
  onSelectedTopicChange?: (topic: string) => void
  onTopicsLoaded?: (topics: string[]) => void
  onTopicCreated?: (topic: string) => void
}

interface TopicImpact {
  total_attempts: number
  completed_attempts: number
  expired_attempts: number
  in_progress_attempts: number
  total_badges: number
  active_badges: number
  expiring_badges: number
  questions: number
  resources: number
}

type TopicAction = 'archive' | 'delete'

const EMPTY_TOPIC_DRAFT = { topic: '', name: '', description: '', icon: '✦', badge_title: '', active: false }

function getErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message
  }
  return fallback
}

const topicFieldClassName = 'mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500'
const topicTextareaClassName = 'mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500'

function displayStatus(status: string): string {
  if (status === 'SUBMITTED') return 'Completed'
  if (status === 'IN_PROGRESS') return 'In progress'
  return status.charAt(0) + status.slice(1).toLowerCase()
}

export function AdminSkillTopicsPanel({
  selectedTopic: controlledTopic,
  onSelectedTopicChange,
  onTopicsLoaded,
  onTopicCreated,
}: AdminSkillTopicsPanelProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [localSelectedTopic, setLocalSelectedTopic] = useState('')
  const selectedTopic = controlledTopic ?? localSelectedTopic
  const [topic, setTopic] = useState<Topic | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [attemptTotal, setAttemptTotal] = useState(0)
  const [filteredAttemptTotal, setFilteredAttemptTotal] = useState(0)
  const [attemptPage, setAttemptPage] = useState(1)
  const [attemptFilter, setAttemptFilter] = useState<AttemptFilter>('ALL')
  const [details, setDetails] = useState<AttemptDetails | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '', icon: '', badge_title: '', active: true })
  const [editing, setEditing] = useState(false)
  const [loadingTopics, setLoadingTopics] = useState(true)
  const [loadingTopic, setLoadingTopic] = useState(false)
  const [loadingAttempts, setLoadingAttempts] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [topicDialogOpen, setTopicDialogOpen] = useState(false)
  const [topicDraft, setTopicDraft] = useState(EMPTY_TOPIC_DRAFT)
  const [editingTopic, setEditingTopic] = useState(false)
  const [lifecycleTopic, setLifecycleTopic] = useState<Topic | null>(null)
  const [lifecycleAction, setLifecycleAction] = useState<TopicAction | null>(null)
  const [impact, setImpact] = useState<TopicImpact | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)
  const impactController = useRef<AbortController | null>(null)
  const [topicFormError, setTopicFormError] = useState('')
  const detailController = useRef<AbortController | null>(null)

  const changeTopic = (nextTopic: string) => {
    if (controlledTopic === undefined) setLocalSelectedTopic(nextTopic)
    onSelectedTopicChange?.(nextTopic)
    setAttemptPage(1)
    setAttemptFilter('ALL')
    setDetails(null)
    setEditing(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoadingTopics(true)
    api.get<Topic[]>(`/skills/admin/skill-topics?include_archived=${showArchived}`, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted) return
      const loaded = response.data
      setTopics(loaded)
      onTopicsLoaded?.(loaded.filter((item) => !item.archived_at).map((item) => item.topic))
      const visibleTopics = loaded.filter((item) => Boolean(item.archived_at) === showArchived)
      if (!visibleTopics.some((item) => item.topic === selectedTopic)) {
        changeTopic(visibleTopics[0]?.topic ?? '')
      }
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return
      console.error('Unable to load skill topic analytics.', requestError)
      setError('Topic analytics could not be loaded.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingTopics(false)
    })
    return () => controller.abort()
  }, [showArchived])

  useEffect(() => {
    if (!selectedTopic) {
      setTopic(null)
      setLoadingTopic(false)
      return
    }
    const controller = new AbortController()
    detailController.current?.abort()
    setTopic(null)
    setLoadingTopic(true)
    setError('')
    const url = `/skills/admin/stats?topic_id=${encodeURIComponent(selectedTopic)}`
    api.get<Topic[]>(url, { signal: controller.signal }).then((response) => {
      if (controller.signal.aborted) return
      setTopic(response.data.find((item) => item.topic === selectedTopic) ?? null)
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return
      console.error(`Unable to load analytics for skill topic ${selectedTopic}.`, requestError)
      setError('Topic analytics could not be loaded.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingTopic(false)
    })
    return () => controller.abort()
  }, [selectedTopic, retry])

  useEffect(() => {
    if (!selectedTopic) return
    const controller = new AbortController()
    setLoadingAttempts(true)
    const params = new URLSearchParams({
      topic_id: selectedTopic,
      page: String(attemptPage),
      page_size: '10',
    })
    if (attemptFilter !== 'ALL') params.set('status', attemptFilter)
    api.get<AttemptPage>(`/skills/admin/topics/${encodeURIComponent(selectedTopic)}/attempts?${params}`, {
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return
      const result = response.data
      setAttempts((current) => attemptPage === 1 ? result.items : [...current, ...result.items])
      setAttemptTotal(result.total)
      setFilteredAttemptTotal(result.filtered_total)
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return
      console.error(`Unable to load attempts for skill topic ${selectedTopic}.`, requestError)
      setError('Recent attempts could not be loaded.')
      if (attemptPage === 1) setAttempts([])
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingAttempts(false)
    })
    return () => controller.abort()
  }, [selectedTopic, attemptPage, attemptFilter, retry])

  useEffect(() => () => detailController.current?.abort(), [selectedTopic])

  const topicMetadata = topics.find((item) => item.topic === selectedTopic)
  const currentTopic = topic && topic.topic === selectedTopic
    ? { ...topicMetadata, ...topic }
    : null

  const beginEdit = () => {
    if (!currentTopic) return
    setDraft({
      name: currentTopic.name,
      description: currentTopic.description,
      icon: currentTopic.icon,
      badge_title: currentTopic.badge_title,
      active: currentTopic.active,
    })
    setEditing(true)
  }

  const loadTopics = async () => {
    setRetry((value) => value + 1)
    try {
      const response = await api.get<Topic[]>(`/skills/admin/skill-topics?include_archived=${showArchived}`)
      setTopics(response.data)
      onTopicsLoaded?.(response.data.filter((item) => !item.archived_at).map((item) => item.topic))
    } catch (requestError) {
      console.error('Unable to refresh skill topic analytics.', requestError)
      setError('Topic analytics could not be refreshed.')
    }
  }

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentTopic) return
    setSaving(true)
    setError('')
    try {
      await api.patch(`/skills/admin/topics/${encodeURIComponent(currentTopic.topic)}`, draft)
      setEditing(false)
      await loadTopics()
    } catch (requestError) {
      console.error(`Unable to update skill topic ${currentTopic.topic}.`, requestError)
      setError(getErrorMessage(requestError, 'Topic settings could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const openTopicEditor = (item?: Topic) => {
    setTopicFormError('')
    setEditingTopic(Boolean(item))
    setTopicDraft(item ? {
      topic: item.topic,
      name: item.name,
      description: item.description,
      icon: item.icon,
      badge_title: item.badge_title,
      active: item.active,
    } : EMPTY_TOPIC_DRAFT)
    setTopicDialogOpen(true)
  }

  const saveTopic = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTopicFormError('')
    setSaving(true)
    try {
      if (editingTopic) {
        await api.patch(`/skills/admin/topics/${encodeURIComponent(topicDraft.topic)}`, {
          name: topicDraft.name,
          description: topicDraft.description,
          icon: topicDraft.icon,
          badge_title: topicDraft.badge_title,
          active: topicDraft.active,
        })
      } else {
        await api.post('/skills/admin/skill-topics', topicDraft)
      }
      const createdTopic = topicDraft.topic
      setTopicDialogOpen(false)
      await loadTopics()
      if (!editingTopic) {
        changeTopic(createdTopic)
        onTopicCreated?.(createdTopic)
      }
    } catch (requestError) {
      console.error(`Unable to ${editingTopic ? 'update' : 'create'} skill topic.`, requestError)
      setTopicFormError(getErrorMessage(requestError, 'Topic could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const changeActivation = async (item: Topic) => {
    setError('')
    try {
      await api.patch(`/skills/admin/topics/${encodeURIComponent(item.topic)}`, { active: !item.active })
      await loadTopics()
      setRetry((value) => value + 1)
    } catch (requestError) {
      console.error(`Unable to change activation for skill topic ${item.topic}.`, requestError)
      setError(getErrorMessage(requestError, 'Topic activation could not be changed.'))
    }
  }

  const openLifecycleDialog = async (item: Topic, action: TopicAction) => {
    impactController.current?.abort()
    const controller = new AbortController()
    impactController.current = controller
    setLifecycleTopic(item)
    setLifecycleAction(action)
    setImpact(null)
    setImpactLoading(true)
    setError('')
    try {
      const response = await api.get<TopicImpact>(
        `/skills/admin/skill-topics/${encodeURIComponent(item.topic)}/impact`,
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) setImpact(response.data)
    } catch (requestError) {
      if (!controller.signal.aborted) {
        console.error(`Unable to load lifecycle impact for skill topic ${item.topic}.`, requestError)
        setError(getErrorMessage(requestError, 'Topic impact could not be loaded.'))
        setLifecycleAction(null)
      }
    } finally {
      if (!controller.signal.aborted) setImpactLoading(false)
    }
  }

  const finishLifecycleAction = async () => {
    if (!lifecycleTopic || !lifecycleAction) return
    setSaving(true)
    setError('')
    try {
      if (lifecycleAction === 'archive') {
        await api.post(`/skills/admin/skill-topics/${encodeURIComponent(lifecycleTopic.topic)}/archive`)
      } else {
        await api.delete(`/skills/admin/skill-topics/${encodeURIComponent(lifecycleTopic.topic)}`)
      }
      const changedTopic = lifecycleTopic.topic
      setLifecycleAction(null)
      setLifecycleTopic(null)
      await loadTopics()
      const replacement = topics.find((item) => item.topic !== changedTopic && Boolean(item.archived_at) === showArchived)
      if (selectedTopic === changedTopic) changeTopic(replacement?.topic ?? '')
      setRetry((value) => value + 1)
    } catch (requestError) {
      console.error(`Unable to ${lifecycleAction} skill topic ${lifecycleTopic.topic}.`, requestError)
      setError(getErrorMessage(requestError, `Topic could not be ${lifecycleAction === 'archive' ? 'archived' : 'deleted'}.`))
      setLifecycleAction(null)
    } finally {
      setSaving(false)
    }
  }

  const restoreTopic = async (item: Topic) => {
    setError('')
    try {
      await api.post(`/skills/admin/skill-topics/${encodeURIComponent(item.topic)}/restore`)
      await loadTopics()
      setShowArchived(false)
      changeTopic(item.topic)
      setRetry((value) => value + 1)
    } catch (requestError) {
      console.error(`Unable to restore skill topic ${item.topic}.`, requestError)
      setError(getErrorMessage(requestError, 'Topic could not be restored.'))
    }
  }

  const loadAttempt = async (attemptId: number) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    setDetails(null)
    setError('')
    try {
      const params = new URLSearchParams({ topic_id: selectedTopic })
      const response = await api.get<AttemptDetails>(`/skills/admin/attempts/${attemptId}?${params}`, {
        signal: controller.signal,
      })
      if (!controller.signal.aborted && response.data.topic === selectedTopic) setDetails(response.data)
    } catch (requestError) {
      if (!controller.signal.aborted) {
        console.error(`Unable to load skill attempt ${attemptId}.`, requestError)
        setError('Attempt details could not be loaded.')
      }
    }
  }

  const selectFilter = (filter: AttemptFilter) => {
    setAttempts([])
    setAttemptPage(1)
    setAttemptFilter(filter)
  }

  const visibleTopics = topics.filter((item) => Boolean(item.archived_at) === showArchived)
  const readinessTargets = { EASY: 4, MEDIUM: 4, HARD: 2 }
  const currentTopicReady = currentTopic
    ? Object.entries(readinessTargets).every(([difficulty, required]) =>
      (currentTopic.difficulty_pool_sizes[difficulty] ?? 0) >= required)
    : false

  return (
    <section aria-labelledby="admin-skill-topics-heading" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="admin-skill-topics-heading" className="text-lg font-bold text-slate-900 dark:text-white">Skill assessment topics</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create and manage topics, check readiness, and review student results.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'Active topics' : 'Archived topics'}
          </Button>
          <Button type="button" size="sm" onClick={() => openTopicEditor()}><Plus className="mr-1 h-4 w-4" />Add topic</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadTopics()}>Refresh</Button>
        </div>
      </header>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setRetry((value) => value + 1); void loadTopics() }}>Retry</Button></div>}
      {loadingTopics ? (
        <div aria-label="Loading assessment topics" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleTopics.map((item) => {
            const ready = Object.entries(readinessTargets).every(([difficulty, required]) =>
              (item.difficulty_pool_sizes[difficulty] ?? 0) >= required)
            const fill = Object.entries(readinessTargets).reduce((sum, [difficulty, required]) =>
              sum + Math.min(item.difficulty_pool_sizes[difficulty] ?? 0, required), 0)
            return (
              <article key={item.topic} className={`min-w-0 rounded-xl border p-4 ${selectedTopic === item.topic ? 'border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-xl dark:bg-slate-800" aria-hidden="true">{item.icon || '✦'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-slate-900 dark:text-white">{item.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.archived_at ? 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : item.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                        {item.archived_at ? 'Archived' : item.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.topic}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-9 text-sm text-slate-600 dark:text-slate-300">{item.description || 'No description provided.'}</p>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className={ready ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'font-medium text-amber-700 dark:text-amber-300'}>{ready ? 'Ready to activate' : 'Not ready'}</span>
                  <span className="text-slate-500">{fill}/10 pool questions</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                  {Object.entries(readinessTargets).map(([difficulty, required]) => {
                    const count = item.difficulty_pool_sizes[difficulty] ?? 0
                    const percent = Math.min(100, Math.round(count / required * 100))
                    return <div key={difficulty} title={`${difficulty}: ${count}/${required} active questions`}>
                      <div className="mb-1 flex justify-between gap-1 text-slate-500"><span>{difficulty}</span><span>{count}/{required} · {item.question_pool_sizes?.[difficulty]?.inactive ?? 0} inactive</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${percent}%` }} /></div>
                    </div>
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{item.active_questions} active questions</span><span>{item.attempts} attempts</span><span>{item.pass_rate}% pass rate</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant={selectedTopic === item.topic ? 'primary' : 'outline'} onClick={() => changeTopic(item.topic)}>Open analytics</Button>
                  {item.archived_at ? (
                    <Button size="sm" variant="outline" onClick={() => void restoreTopic(item)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Restore</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openTopicEditor(item)} aria-label={`Edit ${item.name}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" disabled={!item.active && !ready} onClick={() => void changeActivation(item)}>{item.active ? 'Deactivate' : 'Activate'}</Button>
                      {!item.active && <Button size="sm" variant="outline" onClick={() => void openLifecycleDialog(item, 'archive')} aria-label={`Archive ${item.name}`}><Archive className="h-3.5 w-3.5" /></Button>}
                    </>
                  )}
                  {!item.active && <Button size="sm" variant="ghost" onClick={() => void openLifecycleDialog(item, 'delete')} aria-label={`Delete ${item.name}`}><Trash2 className="h-4 w-4 text-rose-600" /></Button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
      {!loadingTopics && visibleTopics.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          {showArchived ? 'No archived topics.' : 'No assessment topics are configured yet.'}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="space-y-3">
          <DropdownSelect
            label="Assessment topic"
            value={selectedTopic}
            options={visibleTopics.map((item) => ({ value: item.topic, label: `${item.name} (${item.archived_at ? 'Archived' : item.active ? 'Active' : 'Inactive'})` }))}
            onChange={changeTopic}
            disabled={!visibleTopics.length}
          />

          {loadingTopic ? (
            <div aria-label="Loading topic analytics" className="grid gap-3 sm:grid-cols-2">
              {[1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)}
            </div>
          ) : !currentTopic ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700">
              Select a topic to review its analytics.
              {selectedTopic && <Button className="ml-3" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button>}
            </div>
          ) : (
            <article aria-label={`${currentTopic.name} analytics`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="font-bold text-slate-900 dark:text-white">{currentTopic.name}</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{currentTopic.description}</p></div>
                {!currentTopic.archived_at && <Button variant="outline" size="sm" onClick={beginEdit}>Edit topic</Button>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-xs text-slate-500">Attempts</p><p className="font-semibold">{currentTopic.attempts}</p><p className="mt-1 text-[11px] text-slate-500">{currentTopic.attempt_status_counts.completed} completed · {currentTopic.attempt_status_counts.expired} expired · {currentTopic.attempt_status_counts.in_progress} in progress</p></div>
                <div><p className="text-xs text-slate-500">Pass rate</p><p className="font-semibold">{currentTopic.pass_rate}%</p><p className="text-[11px] text-slate-500">Completed attempts only</p></div>
                <div><p className="text-xs text-slate-500">Average score</p><p className="font-semibold">{currentTopic.average_score == null ? '—' : `${currentTopic.average_score}%`}</p><p className="text-[11px] text-slate-500">Completed attempts only</p></div>
                <div><p className="text-xs text-slate-500">Question pool</p><p className="font-semibold">{Object.entries(currentTopic.difficulty_pool_sizes).map(([key, count]) => `${key} ${count}`).join(' · ')}</p><p className="text-[11px] text-slate-500">{currentTopic.active_questions} active questions · {currentTopicReady ? 'Ready' : 'Not ready'}</p></div>
              </div>
              {currentTopic.bank_warnings.length > 0
                ? <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">{currentTopic.bank_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                : <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">Question pool is ready.</p>}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div><h4 className="text-xs font-semibold uppercase text-slate-500">Weakest subtopics</h4>{!currentTopic.analytics_ready ? <p className="mt-2 text-xs text-slate-500">Not enough data yet (fewer than 5 completed attempts).</p> : currentTopic.weakest_subtopics.length ? <ul className="mt-2 space-y-1 text-xs">{currentTopic.weakest_subtopics.map((item) => <li key={item.subtopic} className="flex justify-between gap-2"><span>{item.subtopic}</span><span>{item.average_percentage}% · {item.attempts} attempts</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No completed subtopic results.</p>}</div>
                <div><h4 className="text-xs font-semibold uppercase text-slate-500">Hardest questions</h4>{!currentTopic.analytics_ready ? <p className="mt-2 text-xs text-slate-500">Not enough data yet (fewer than 5 completed attempts).</p> : currentTopic.hardest_questions.length ? <ul className="mt-2 space-y-1 text-xs">{currentTopic.hardest_questions.slice(0, 3).map((item) => <li key={item.question_id} className="flex justify-between gap-2"><span className="line-clamp-1">{item.prompt}</span><span>{item.correct_rate == null ? 'No data' : `${item.correct_rate}%`}</span></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No completed question results.</p>}</div>
              </div>
            </article>
          )}
        </div>

        <aside className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          {editing && currentTopic ? (
            <form onSubmit={(event) => void save(event)} className="space-y-3">
              <h3 className="font-semibold text-slate-900 dark:text-white">Edit topic settings</h3>
              <label htmlFor="admin-skill-topic-name" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Display name<input id="admin-skill-topic-name" required minLength={3} maxLength={60} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={topicFieldClassName} /></label>
              <label htmlFor="admin-skill-topic-description" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Description<textarea id="admin-skill-topic-description" maxLength={200} rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className={topicTextareaClassName} /></label>
              <label htmlFor="admin-skill-topic-icon" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Icon / symbol<input id="admin-skill-topic-icon" required maxLength={80} value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))} className={topicFieldClassName} /></label>
              <label htmlFor="admin-skill-topic-badge-title" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Badge title<input id="admin-skill-topic-badge-title" required maxLength={255} value={draft.badge_title} onChange={(event) => setDraft((current) => ({ ...current, badge_title: event.target.value }))} className={topicFieldClassName} /></label>
              <div className="flex gap-2"><Button type="submit" variant="primary" size="sm" isLoading={saving}>Save settings</Button><Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
            </form>
          ) : (
            <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">Recent attempts</h3>
                  <span className="text-xs text-slate-500">{currentTopic?.attempts ?? attemptTotal} total</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Filter recent attempts">
                  {(['ALL', 'COMPLETED', 'EXPIRED', 'IN_PROGRESS'] as const).map((filter) => (
                    <Button key={filter} type="button" size="sm" variant={attemptFilter === filter ? 'primary' : 'outline'} onClick={() => selectFilter(filter)}>
                      {filter === 'ALL' ? 'All' : displayStatus(filter)}
                    </Button>
                  ))}
                </div>
                {loadingAttempts && attempts.length === 0 ? <p role="status" className="mt-4 text-sm text-slate-500">Loading attempts…</p> : attempts.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">No {attemptFilter === 'ALL' ? '' : `${displayStatus(attemptFilter).toLowerCase()} `}attempts for this topic.</p> : (
                  <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-700">
                    {attempts.map((attempt) => {
                      const status = attempt.status === 'SUBMITTED' ? 'COMPLETED' : attempt.status
                      const score = status === 'EXPIRED' || attempt.score == null ? '—' : `${attempt.score}%`
                      return <li key={attempt.id} className="flex items-center justify-between gap-2 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{attempt.student_email}</p>
                          <p className="text-xs text-slate-500">{displayStatus(status)} · {score}</p>
                          <p className="text-[11px] text-slate-500">{new Date(attempt.submitted_at ?? attempt.started_at).toLocaleString()}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => void loadAttempt(attempt.id)}>View</Button>
                      </li>
                    })}
                  </ul>
                )}
                {attempts.length < filteredAttemptTotal && <Button className="mt-3 w-full" size="sm" variant="outline" disabled={loadingAttempts} onClick={() => setAttemptPage((page) => page + 1)}>Load more</Button>}
                {details && details.topic === selectedTopic && <div role="dialog" aria-label="Assessment attempt details" className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm dark:bg-indigo-950/30"><div className="flex items-center justify-between"><h4 className="font-semibold">Attempt #{details.id}</h4><Button size="sm" variant="ghost" aria-label="Close attempt details" onClick={() => setDetails(null)}>Close</Button></div><p className="mt-2">{details.student_email} · {displayStatus(details.status)} · {details.status === 'EXPIRED' || details.score == null ? '—' : `${details.score}%`}</p><p className="text-xs text-slate-600 dark:text-slate-300">{details.passed ? 'Passed' : details.passed === false ? 'Not passed' : 'Result unavailable'} · {details.level ?? 'No level'} · Percentile {details.percentile ?? '—'}</p><ul className="mt-2 space-y-1 text-xs">{Object.entries(details.subtopic_scores).map(([key, value]) => <li key={key} className="flex justify-between"><span>{key}</span><span>{value.percentage}%</span></li>)}</ul></div>}
              </>
          )}
        </aside>
      </div>

      <Modal isOpen={topicDialogOpen} onClose={() => setTopicDialogOpen(false)} title={editingTopic ? 'Edit skill topic' : 'Add skill topic'} description={editingTopic ? 'Update display details for this topic.' : 'Topics start inactive and require a ready question pool before activation.'} maxWidth="lg">
        <form onSubmit={(event) => void saveTopic(event)} className="space-y-4">
          {!editingTopic && <label htmlFor="new-skill-topic-id" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Topic ID<input id="new-skill-topic-id" aria-label="Topic ID" required minLength={2} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={topicDraft.topic} onChange={(event) => setTopicDraft((current) => ({ ...current, topic: event.target.value.toLowerCase() }))} placeholder="e.g. data-science" className={topicFieldClassName} /><span className="mt-1 block font-normal text-slate-500">Lowercase letters and numbers, separated by hyphens.</span></label>}
          <label htmlFor="new-skill-topic-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Display name<input id="new-skill-topic-name" aria-label="Display name" required minLength={3} maxLength={60} value={topicDraft.name} onChange={(event) => setTopicDraft((current) => ({ ...current, name: event.target.value }))} className={topicFieldClassName} /></label>
          <label htmlFor="new-skill-topic-description" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Description<textarea id="new-skill-topic-description" aria-label="Description" maxLength={200} rows={3} value={topicDraft.description} onChange={(event) => setTopicDraft((current) => ({ ...current, description: event.target.value }))} className={topicTextareaClassName} /><span className="mt-1 block font-normal text-slate-500">Up to 200 characters.</span></label>
          <label htmlFor="new-skill-topic-icon" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Icon or symbol<input id="new-skill-topic-icon" aria-label="Icon or symbol" required maxLength={80} value={topicDraft.icon} onChange={(event) => setTopicDraft((current) => ({ ...current, icon: event.target.value }))} className={topicFieldClassName} /></label>
          <label htmlFor="new-skill-topic-badge-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Badge title<input id="new-skill-topic-badge-title" aria-label="Badge title" maxLength={255} value={topicDraft.badge_title} onChange={(event) => setTopicDraft((current) => ({ ...current, badge_title: event.target.value }))} className={topicFieldClassName} /></label>
          {topicFormError && <p role="alert" className="text-sm text-rose-600">{topicFormError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setTopicDialogOpen(false)}>Cancel</Button><Button type="submit" size="sm" isLoading={saving}>{editingTopic ? 'Save topic' : 'Create topic'}</Button></div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(lifecycleAction && lifecycleTopic)}
        onClose={() => { setLifecycleAction(null); setLifecycleTopic(null) }}
        title={lifecycleAction === 'archive' ? 'Archive skill topic?' : 'Delete skill topic permanently?'}
        description={lifecycleAction === 'archive' ? 'Archived topics are hidden from students. Historical attempts and badges remain available to administrators.' : 'This permanently removes the topic and its questions/resources. Topics with historical attempts or badges cannot be deleted.'}
        maxWidth="lg"
      >
        {lifecycleTopic && (
          <div className="space-y-4">
            <p className="font-medium text-slate-900 dark:text-white">{lifecycleTopic.name} ({lifecycleTopic.topic})</p>
            {impactLoading ? <div role="status" className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /> : impact && (
              <dl className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <div><dt className="text-slate-500">Attempts</dt><dd className="font-semibold">{impact.total_attempts} ({impact.completed_attempts} completed, {impact.expired_attempts} expired, {impact.in_progress_attempts} in progress)</dd></div>
                <div><dt className="text-slate-500">Badges</dt><dd className="font-semibold">{impact.total_badges} ({impact.active_badges} valid, {impact.expiring_badges} expiring within 30 days)</dd></div>
                <div><dt className="text-slate-500">Questions</dt><dd className="font-semibold">{impact.questions}</dd></div>
                <div><dt className="text-slate-500">Resources</dt><dd className="font-semibold">{impact.resources}</dd></div>
              </dl>
            )}
            {lifecycleAction && impact && impact.in_progress_attempts > 0 && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Wait until all {impact.in_progress_attempts} non-expired attempt(s) finish or expire before continuing.</p>}
            {lifecycleAction === 'delete' && impact && (impact.total_attempts > 0 || impact.total_badges > 0) && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">This topic has historical records and cannot be permanently deleted. Archive it to preserve the history.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setLifecycleAction(null); setLifecycleTopic(null) }}>Cancel</Button>
              <Button variant={lifecycleAction === 'delete' ? 'danger' : 'primary'} size="sm" disabled={impactLoading || !impact || Boolean(impact.in_progress_attempts) || (lifecycleAction === 'delete' && Boolean(impact.total_attempts || impact.total_badges))} isLoading={saving} onClick={() => void finishLifecycleAction()}>
                {lifecycleAction === 'archive' ? 'Archive topic' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
