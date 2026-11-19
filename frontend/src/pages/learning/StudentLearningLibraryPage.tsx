import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, BookmarkCheck, BookOpen, CheckCircle2, ExternalLink, GraduationCap, ListChecks, RotateCw, Search, Sparkles } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import {
  getLearningPath,
  getLearningPreference,
  getLearningProgress,
  getLearningRecommendations,
  listLearningCategories,
  listLearningPaths,
  listLearningResources,
  setLearningBookmark,
  updateLearningPreference,
  updateLearningResourceProgress,
} from '../../services/learningLibraryService'
import type {
  LearningCategory,
  LearningPath,
  LearningProgress,
  LearningRecommendations,
  LearningResource,
  LearningSection,
} from '../../types/learningLibrary'

const roleOptions = [
  ['data-scientist', 'Data Scientist'],
  ['data-analyst', 'Data Analyst'],
  ['python-developer', 'Python Developer'],
  ['java-developer', 'Java Developer'],
  ['frontend-developer', 'Frontend Developer'],
  ['ml-engineer', 'ML Engineer'],
  ['hr-interview', 'HR Interview Preparation'],
  ['video-interview', 'Video Interview Preparation'],
] as const

const sections: Array<{ id: LearningSection; label: string; icon: typeof BookOpen; topic?: string }> = [
  { id: 'LEARNING_PATHS', label: 'Learning Paths', icon: GraduationCap },
  { id: 'INTERVIEW_QUESTIONS', label: 'Interview Questions', icon: Sparkles, topic: 'interview-questions' },
  { id: 'CODING_PRACTICE', label: 'Coding Practice', icon: BookOpen, topic: 'coding-practice' },
  { id: 'COURSES', label: 'Courses', icon: GraduationCap, topic: 'courses' },
  { id: 'PRACTICE_TESTS', label: 'Practice Tests', icon: ListChecks, topic: 'practice-tests' },
  { id: 'MY_PROGRESS', label: 'My Progress', icon: CheckCircle2 },
]

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') return response.data.detail
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.'
}

function LearningResourceCard({
  resource,
  onBookmark,
  onView,
  onComplete,
  busy,
}: {
  resource: LearningResource
  onBookmark: (resource: LearningResource) => void
  onView: (resource: LearningResource) => void
  onComplete: (resource: LearningResource) => void
  busy: boolean
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            {resource.category?.replaceAll('-', ' ')} · {resource.type} · {resource.level.toLowerCase()}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{resource.title}</h3>
        </div>
        <button
          type="button"
          aria-label={resource.bookmarked ? `Remove ${resource.title} bookmark` : `Bookmark ${resource.title}`}
          aria-pressed={resource.bookmarked}
          disabled={busy}
          onClick={() => onBookmark(resource)}
          className="rounded-lg p-2 text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800"
        >
          {resource.bookmarked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
        </button>
      </div>
      <p className="mt-2 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{resource.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {resource.topic_tags.slice(0, 5).map((tag) => (
          <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tag.replaceAll('-', ' ')}</span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {resource.progress === 'COMPLETED' ? 'Completed' : resource.progress === 'VIEWED' ? 'Viewed' : 'Not started'}
        </span>
        <div className="flex gap-2">
          {resource.progress !== 'COMPLETED' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onComplete(resource)}>
              Mark complete
            </Button>
          )}
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              if (!resource.progress) onView(resource)
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Open resource <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  )
}

export function StudentLearningLibraryPage() {
  const [section, setSection] = useState<LearningSection>('LEARNING_PATHS')
  const [categories, setCategories] = useState<LearningCategory[]>([])
  const [paths, setPaths] = useState<LearningPath[]>([])
  const [resources, setResources] = useState<LearningResource[]>([])
  const [progress, setProgress] = useState<LearningProgress | null>(null)
  const [recommendations, setRecommendations] = useState<LearningRecommendations | null>(null)
  const [targetRole, setTargetRole] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [search, setSearch] = useState('')
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  const [selectedPath, setSelectedPath] = useState<LearningPath | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyResource, setBusyResource] = useState<number | null>(null)
  const [reload, setReload] = useState(0)

  const sectionTopic = sections.find((item) => item.id === section)?.topic

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [categoryRows, preference] = await Promise.all([
        listLearningCategories(),
        getLearningPreference(),
      ])
      setCategories(categoryRows)
      const role = preference.target_role ?? ''
      setTargetRole(role)
      const [pathRows, resourcePage, progressRows, recommended] = await Promise.all([
        listLearningPaths(role || undefined),
        listLearningResources({
          search: search || undefined,
          category: categoryFilter || undefined,
          level: levelFilter || undefined,
          role: role || undefined,
          section: sectionTopic,
          bookmarked: bookmarkedOnly || undefined,
        }),
        getLearningProgress(),
        getLearningRecommendations(role || undefined),
      ])
      setPaths(pathRows)
      setResources(resourcePage.items)
      setProgress(progressRows)
      setRecommendations(recommended)
      if (selectedPath) {
        const refreshedPath = await getLearningPath(selectedPath.id)
        setSelectedPath(refreshedPath)
      }
    } catch (loadError) {
      setError(errorText(loadError))
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, levelFilter, search, sectionTopic, bookmarkedOnly, selectedPath?.id])

  useEffect(() => {
    void load()
  }, [load, reload])

  const applyTargetRole = async (value: string) => {
    setTargetRole(value)
    setError('')
    try {
      const updated = await updateLearningPreference(value || null)
      setTargetRole(updated.target_role ?? '')
      setSelectedPath(null)
      setReload((current) => current + 1)
    } catch (saveError) {
      setError(errorText(saveError))
    }
  }

  const changeBookmark = async (resource: LearningResource) => {
    setBusyResource(resource.id)
    setError('')
    try {
      await setLearningBookmark(resource.id, !resource.bookmarked)
      setResources((current) => current.map((item) => item.id === resource.id
        ? { ...item, bookmarked: !resource.bookmarked }
        : item))
      setRecommendations((current) => current && ({
        ...current,
        resources: current.resources.map((item) => item.id === resource.id
          ? { ...item, bookmarked: !resource.bookmarked }
          : item),
      }))
      const progressRows = await getLearningProgress()
      setProgress(progressRows)
      if (selectedPath) setSelectedPath(await getLearningPath(selectedPath.id))
    } catch (bookmarkError) {
      setError(errorText(bookmarkError))
    } finally {
      setBusyResource(null)
    }
  }

  const markResource = async (
    resource: LearningResource,
    status: 'VIEWED' | 'COMPLETED' = 'COMPLETED',
  ) => {
    setBusyResource(resource.id)
    setError('')
    try {
      await updateLearningResourceProgress(resource.id, status)
      setResources((current) => current.map((item) => item.id === resource.id
        ? { ...item, progress: status === 'VIEWED' && item.progress === 'COMPLETED' ? 'COMPLETED' : status }
        : item))
      setRecommendations((current) => current && ({
        ...current,
        resources: current.resources.map((item) => item.id === resource.id
          ? { ...item, progress: status === 'VIEWED' && item.progress === 'COMPLETED' ? 'COMPLETED' : status }
          : item),
      }))
      setProgress(await getLearningProgress())
      if (selectedPath) setSelectedPath(await getLearningPath(selectedPath.id))
      setNotice(status === 'COMPLETED' ? 'Progress saved.' : 'Marked as viewed.')
    } catch (progressError) {
      setError(errorText(progressError))
    } finally {
      setBusyResource(null)
    }
  }

  const visibleResources = useMemo(() => {
    if (section === 'MY_PROGRESS') return progress?.items ?? []
    return resources
  }, [progress, resources, section])

  const choosePath = async (pathId: number) => {
    setError('')
    try {
      setSelectedPath(await getLearningPath(pathId))
    } catch (pathError) {
      setError(errorText(pathError))
    }
  }

  const recommendationHeading = recommendations?.weakest_skill
    ? `Recommended to strengthen ${recommendations.weakest_skill.replaceAll('-', ' ')}`
    : targetRole
      ? 'Recommended for your target role'
      : 'Choose a target role for personalized recommendations'

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">Student learning library</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">Build skills with a clear next step</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">Explore role-based paths and verified resources. Your progress and bookmarks are private to your account.</p>
        </div>
        <label className="min-w-60 text-sm font-medium">
          Your target role
          <select aria-label="Your target role" className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" value={targetRole} onChange={(event) => void applyTargetRole(event.target.value)}>
            <option value="">Select a target role</option>
            {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </header>

      <section aria-labelledby="recommendations-title" className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300" />
          <div>
            <h2 id="recommendations-title" className="font-semibold text-slate-900 dark:text-white">Recommended for you</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{recommendationHeading}</p>
          </div>
        </div>
        {recommendations?.resources.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recommendations.resources.slice(0, 3).map((resource) => (
              <LearningResourceCard
                key={resource.id}
                resource={resource}
                onBookmark={changeBookmark}
                onView={(item) => void markResource(item, 'VIEWED')}
                onComplete={(item) => void markResource(item)}
                busy={busyResource === resource.id}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {recommendations?.weakest_skill
              ? `No verified resource is mapped to ${recommendations.weakest_skill} yet. Browse a learning path below.`
              : 'Complete a Mock Test to get skill-based recommendations, or choose a target role to see its learning path.'}
          </p>
        )}
        {recommendations?.paths.map((path) => (
          <button key={path.id} type="button" onClick={() => void choosePath(path.id)} className="text-sm font-semibold text-indigo-700 underline dark:text-indigo-300">
            View {path.title} path
          </button>
        ))}
      </section>

      <nav aria-label="Learning library sections" className="flex gap-2 overflow-x-auto pb-1">
        {sections.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => {
                setSection(item.id)
                setSelectedPath(null)
                setBookmarkedOnly(item.id === 'MY_PROGRESS' ? bookmarkedOnly : false)
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${section === item.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800'}`}
            >
              <Icon className="h-4 w-4" />{item.label}
            </button>
          )
        })}
      </nav>

      {section !== 'LEARNING_PATHS' && section !== 'MY_PROGRESS' && (
        <section aria-label="Resource filters" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold">Search
            <span className="relative mt-1 block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="h-10 w-full rounded-lg border border-slate-300 bg-transparent pl-9 pr-3 text-sm dark:border-slate-700" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, topic, or skill" /></span>
          </label>
          <label className="text-xs font-semibold">Category
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>{categories.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Level
            <select className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
              <option value="">All levels</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={bookmarkedOnly} onChange={(event) => setBookmarkedOnly(event.target.checked)} />
            Bookmarks only
          </label>
        </section>
      )}

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}<Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}><RotateCw className="mr-1 h-4 w-4" />Retry</Button></div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Loading learning library…</p>}

      {!loading && section === 'LEARNING_PATHS' && (
        <section aria-label="Learning paths" className="space-y-4">
          {selectedPath && (
            <article className="rounded-2xl border border-indigo-200 bg-white p-5 dark:border-indigo-900 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase text-indigo-600">Learning path</p><h2 className="mt-1 text-xl font-bold">{selectedPath.title}</h2><p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{selectedPath.description}</p></div>
                <Button variant="secondary" onClick={() => setSelectedPath(null)}>Close path</Button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${selectedPath.progress_percent}%` }} /></div>
                <span className="text-sm font-semibold">{selectedPath.progress_percent}% · {selectedPath.completed_count}/{selectedPath.resource_count}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {selectedPath.resources.map((resource) => <LearningResourceCard key={resource.id} resource={resource} onBookmark={changeBookmark} onView={(item) => void markResource(item, 'VIEWED')} onComplete={(item) => void markResource(item)} busy={busyResource === resource.id} />)}
              </div>
            </article>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paths.map((path) => (
              <button key={path.id} type="button" onClick={() => void choosePath(path.id)} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase text-indigo-600">{path.category?.replaceAll('-', ' ')}</p>
                <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{path.title}</h3>
                <p className="mt-2 min-h-12 text-sm text-slate-600 dark:text-slate-300">{path.description}</p>
                <div className="mt-4 flex items-center justify-between text-xs"><span>{path.completed_count}/{path.resource_count} resources completed</span><strong>{path.progress_percent}%</strong></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${path.progress_percent}%` }} /></div>
              </button>
            ))}
          </div>
          {!paths.length && <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">No active learning paths are available for this role yet.</p>}
        </section>
      )}

      {!loading && (section === 'INTERVIEW_QUESTIONS' || section === 'CODING_PRACTICE' || section === 'COURSES' || section === 'PRACTICE_TESTS' || section === 'MY_PROGRESS') && (
        <section aria-label={sections.find((item) => item.id === section)?.label} className="space-y-3">
          {section === 'MY_PROGRESS' && <div className="flex flex-wrap gap-4 rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-900"><strong>{progress?.viewed_count ?? 0} viewed</strong><strong>{progress?.completed_count ?? 0} completed</strong></div>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleResources.map((resource) => <LearningResourceCard key={resource.id} resource={resource} onBookmark={changeBookmark} onView={(item) => void markResource(item, 'VIEWED')} onComplete={(item) => void markResource(item)} busy={busyResource === resource.id} />)}
          </div>
          {!visibleResources.length && <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">{section === 'MY_PROGRESS' ? 'You have not viewed or completed any resources yet.' : 'No matching verified resources. Try changing the filters.'}</p>}
        </section>
      )}
    </main>
  )
}
