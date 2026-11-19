import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Pencil, Plus, Power } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { DataList } from '../../components/ui/DataList'
import { IconButton } from '../../components/ui/IconButton'
import {
  createAdminLearningCategory,
  createAdminLearningPath,
  createAdminLearningResource,
  listAdminLearningAudit,
  listAdminLearningCategories,
  listAdminLearningPaths,
  listAdminLearningResources,
  updateAdminLearningCategory,
  updateAdminLearningPath,
  updateAdminLearningResource,
  verifyAdminLearningResource,
  type AdminLearningCategory,
  type AdminLearningPath,
  type AdminLearningResource,
  type LearningCategoryInput,
  type LearningPathInput,
  type LearningResourceInput,
} from '../../services/learningLibraryAdminService'

type AdminTab = 'resources' | 'paths' | 'categories' | 'audit'

const roleChoices = [
  ['data-scientist', 'Data Scientist'],
  ['data-analyst', 'Data Analyst'],
  ['python-developer', 'Python Developer'],
  ['java-developer', 'Java Developer'],
  ['frontend-developer', 'Frontend Developer'],
  ['ml-engineer', 'ML Engineer'],
  ['hr-interview', 'HR Interview'],
  ['video-interview', 'Video Interview'],
] as const

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950'
const blankResource = (): LearningResourceInput => ({
  slug: '',
  category_id: 0,
  title: '',
  description: '',
  url: '',
  resource_type: 'link',
  level: 'ALL',
  role_tags: [],
  topic_tags: [],
  active: true,
})
const blankPath = (): LearningPathInput => ({
  slug: '',
  category_id: 0,
  title: '',
  description: '',
  role_tags: [],
  topic_tags: [],
  active: true,
  resources: [],
})

function messageFromError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') return response.data.detail
    if (response?.data?.detail && typeof response.data.detail === 'object') {
      return 'The submitted data is invalid. Check the URL, tags, and required fields.'
    }
  }
  return error instanceof Error ? error.message : 'The request failed. Please retry.'
}

function parseTags(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim().toLowerCase().replaceAll(' ', '-')).filter(Boolean))]
}

function eventSummary(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value)
  return '—'
}

export function AdminLearningLibraryPage() {
  const [tab, setTab] = useState<AdminTab>('resources')
  const [categories, setCategories] = useState<AdminLearningCategory[]>([])
  const [resources, setResources] = useState<AdminLearningResource[]>([])
  const [paths, setPaths] = useState<AdminLearningPath[]>([])
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([])
  const [resourceDraft, setResourceDraft] = useState<LearningResourceInput>(blankResource())
  const [resourceTags, setResourceTags] = useState({ roles: '', topics: '' })
  const [editingResource, setEditingResource] = useState<number | null>(null)
  const [pathDraft, setPathDraft] = useState<LearningPathInput>(blankPath())
  const [pathTags, setPathTags] = useState({ roles: '', topics: '' })
  const [editingPath, setEditingPath] = useState<number | null>(null)
  const [categoryDraft, setCategoryDraft] = useState<LearningCategoryInput>({
    slug: '',
    title: '',
    description: '',
    active: true,
  })
  const [editingCategory, setEditingCategory] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const [resourceSearch, setResourceSearch] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [resourceState, setResourceState] = useState('')
  const visibleResources = useMemo(() => resources.filter((resource) => {
    const matchesSearch = !resourceSearch
      || `${resource.title} ${resource.url} ${resource.slug}`.toLowerCase().includes(resourceSearch.toLowerCase())
    const matchesType = !resourceType || resource.type === resourceType
    const matchesState = !resourceState
      || (resourceState === 'ACTIVE' ? resource.active : !resource.active)
    return matchesSearch && matchesType && matchesState
  }), [resources, resourceSearch, resourceType, resourceState])

  const load = useCallback(async () => {
    setError('')
    try {
      const [categoryRows, resourceRows, pathRows] = await Promise.all([
        listAdminLearningCategories(),
        listAdminLearningResources(),
        listAdminLearningPaths(),
      ])
      setCategories(categoryRows)
      setResources(resourceRows)
      setPaths(pathRows)
      if (tab === 'audit') setAudit(await listAdminLearningAudit())
    } catch (loadError) {
      setError(messageFromError(loadError))
    }
  }, [tab])

  useEffect(() => {
    void load()
  }, [load, reload])

  const runMutation = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      setNotice(success)
      await load()
    } catch (mutationError) {
      setError(messageFromError(mutationError))
    } finally {
      setBusy(false)
    }
  }

  const submitResource = async (event: FormEvent) => {
    event.preventDefault()
    const payload = {
      ...resourceDraft,
      role_tags: parseTags(resourceTags.roles),
      topic_tags: parseTags(resourceTags.topics),
    }
    if (editingResource === null && !payload.slug) {
      setError('Enter a unique resource slug.')
      return
    }
    await runMutation(async () => {
      if (editingResource === null) await createAdminLearningResource(payload)
      else {
        const { slug: _slug, ...updates } = payload
        await updateAdminLearningResource(editingResource, updates)
      }
      setResourceDraft(blankResource())
      setResourceTags({ roles: '', topics: '' })
      setEditingResource(null)
    }, editingResource === null ? 'Resource added. Verify it before it appears to students.' : 'Resource updated.')
  }

  const startEditResource = (resource: AdminLearningResource) => {
    setEditingResource(resource.id)
    setResourceDraft({
      category_id: resource.category_id,
      title: resource.title,
      description: resource.description,
      url: resource.url,
      resource_type: resource.type,
      level: resource.level,
      role_tags: resource.role_tags,
      topic_tags: resource.topic_tags,
      active: resource.active,
    })
    setResourceTags({ roles: resource.role_tags.join(', '), topics: resource.topic_tags.join(', ') })
  }

  const submitPath = async (event: FormEvent) => {
    event.preventDefault()
    const payload = {
      ...pathDraft,
      role_tags: parseTags(pathTags.roles),
      topic_tags: parseTags(pathTags.topics),
    }
    if (editingPath === null && !payload.slug) {
      setError('Enter a unique path slug.')
      return
    }
    if (payload.resources.length === 0) {
      setError('Select at least one resource for this path.')
      return
    }
    await runMutation(async () => {
      if (editingPath === null) await createAdminLearningPath(payload)
      else await updateAdminLearningPath(editingPath, payload)
      setPathDraft(blankPath())
      setPathTags({ roles: '', topics: '' })
      setEditingPath(null)
    }, editingPath === null ? 'Learning path created.' : 'Learning path updated.')
  }

  const editPath = (path: AdminLearningPath) => {
    setEditingPath(path.id)
    setPathDraft({
      slug: path.slug,
      category_id: path.category_id,
      title: path.title,
      description: path.description,
      role_tags: path.role_tags,
      topic_tags: path.topic_tags,
      active: path.active,
      resources: path.resources.map((resource) => ({ resource_id: resource.resource_id })),
    })
    setPathTags({ roles: path.role_tags.join(', '), topics: path.topic_tags.join(', ') })
  }

  const submitCategory = async (event: FormEvent) => {
    event.preventDefault()
    await runMutation(async () => {
      if (editingCategory === null) await createAdminLearningCategory(categoryDraft)
      else await updateAdminLearningCategory(editingCategory, {
        title: categoryDraft.title,
        description: categoryDraft.description,
        active: categoryDraft.active,
      })
      setCategoryDraft({ slug: '', title: '', description: '', active: true })
      setEditingCategory(null)
    }, editingCategory === null ? 'Category created.' : 'Category updated.')
  }

  const toggleResource = (resourceId: number) => {
    setPathDraft((current) => ({
      ...current,
      resources: current.resources.some((item) => item.resource_id === resourceId)
        ? current.resources.filter((item) => item.resource_id !== resourceId)
        : [...current.resources, { resource_id: resourceId }],
    }))
  }

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'resources', label: 'Resources' },
    { id: 'paths', label: 'Learning paths' },
    { id: 'categories', label: 'Categories' },
    { id: 'audit', label: 'Audit log' },
  ]

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-indigo-600">Admin management</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">Learning Library</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Only active, verified resources are visible to students. URL changes remove verification until reviewed again.</p>
      </header>
      <nav aria-label="Learning library administration" className="flex flex-wrap gap-2">
        {tabs.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === item.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800'}`}>{item.label}</button>)}
      </nav>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-100">{error}<Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>Retry</Button></div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}

      {tab === 'resources' && (
        <section className="space-y-5">
          <form onSubmit={(event) => void submitResource(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <h2 className="text-lg font-bold md:col-span-2">{editingResource === null ? 'Add resource' : `Edit resource #${editingResource}`}</h2>
            {editingResource === null && <label className="text-sm font-medium">Slug<input required pattern="[a-z0-9-]+" minLength={2} maxLength={100} className={inputClass} value={resourceDraft.slug ?? ''} onChange={(event) => setResourceDraft({ ...resourceDraft, slug: event.target.value })} /></label>}
            <label className="text-sm font-medium">Title<input required minLength={2} maxLength={180} className={inputClass} value={resourceDraft.title} onChange={(event) => setResourceDraft({ ...resourceDraft, title: event.target.value })} /></label>
            <label className="text-sm font-medium">Category<select required className={inputClass} value={resourceDraft.category_id || ''} onChange={(event) => setResourceDraft({ ...resourceDraft, category_id: Number(event.target.value) })}><option value="">Choose category</option>{categories.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label className="text-sm font-medium md:col-span-2">Description<textarea required minLength={5} maxLength={5000} className={inputClass} rows={2} value={resourceDraft.description} onChange={(event) => setResourceDraft({ ...resourceDraft, description: event.target.value })} /></label>
            <label className="text-sm font-medium md:col-span-2">External URL (HTTPS only)<input required type="url" pattern="https://.*" className={inputClass} value={resourceDraft.url} onChange={(event) => setResourceDraft({ ...resourceDraft, url: event.target.value })} /></label>
            <label className="text-sm font-medium">Format<select className={inputClass} value={resourceDraft.resource_type} onChange={(event) => setResourceDraft({ ...resourceDraft, resource_type: event.target.value as LearningResourceInput['resource_type'] })}>{['link', 'video', 'pdf', 'notes', 'course'].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="text-sm font-medium">Level<select className={inputClass} value={resourceDraft.level} onChange={(event) => setResourceDraft({ ...resourceDraft, level: event.target.value as LearningResourceInput['level'] })}>{['ALL', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((level) => <option key={level}>{level}</option>)}</select></label>
            <label className="text-sm font-medium">Role tags (comma-separated)<input className={inputClass} value={resourceTags.roles} onChange={(event) => setResourceTags({ ...resourceTags, roles: event.target.value })} placeholder={roleChoices.map(([, label]) => label).slice(0, 3).join(', ')} /></label>
            <label className="text-sm font-medium">Topic tags (comma-separated)<input className={inputClass} value={resourceTags.topics} onChange={(event) => setResourceTags({ ...resourceTags, topics: event.target.value })} placeholder="sql, coding-practice" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={resourceDraft.active} onChange={(event) => setResourceDraft({ ...resourceDraft, active: event.target.checked })} />Active</label>
            <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy} leftIcon={editingResource === null ? <Plus className="h-4 w-4" /> : undefined}>{editingResource === null ? 'Add resource' : 'Save changes'}</Button>{editingResource !== null && <Button type="button" variant="secondary" onClick={() => { setEditingResource(null); setResourceDraft(blankResource()); setResourceTags({ roles: '', topics: '' }) }}>Cancel edit</Button>}</div>
          </form>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <label className="min-w-52 flex-1 text-xs font-semibold">Search resources<input className={inputClass} value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} placeholder="Title, URL, or slug" /></label>
            <label className="text-xs font-semibold">Type<select className={inputClass} value={resourceType} onChange={(event) => setResourceType(event.target.value)}><option value="">All types</option>{['link', 'video', 'pdf', 'notes', 'course'].map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="text-xs font-semibold">State<select className={inputClass} value={resourceState} onChange={(event) => setResourceState(event.target.value)}><option value="">All states</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
            <span className="pb-2 text-xs text-slate-500">{visibleResources.length} resources</span>
          </div>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Resources ({visibleResources.length})</h3>
          <DataList
            ariaLabel="Learning resources"
            rows={visibleResources}
            getRowKey={(resource) => resource.id}
            emptyState={resources.length ? 'No resources match these filters.' : 'No resources yet.'}
            columns={[
              { key: 'resource', header: 'Resource', render: (resource) => <div><p className="font-semibold">{resource.title}</p><p className="mt-1 max-w-lg truncate text-xs text-slate-500">{resource.url}</p></div> },
              { key: 'category', header: 'Category · type', render: (resource) => <span>{resource.category ?? '—'} · {resource.type}</span> },
              { key: 'state', header: 'State', render: (resource) => <div className="flex flex-wrap gap-1.5"><Badge variant={resource.active ? 'emerald' : 'slate'}>{resource.active ? 'Active' : 'Inactive'}</Badge><Badge variant={resource.verified_at ? 'blue' : 'amber'}>{resource.verified_at ? 'Verified' : 'Unverified'}</Badge></div> },
            ]}
            actions={(resource) => (
              <>
                <IconButton icon={Pencil} aria-label={`Edit resource ${resource.title}`} onClick={() => startEditResource(resource)} />
                <IconButton
                  icon={Check}
                  variant="primary"
                  aria-label={`Verify resource ${resource.title}`}
                  disabled={busy || !resource.active || Boolean(resource.verified_at)}
                  onClick={() => void runMutation(() => verifyAdminLearningResource(resource.id), 'Resource verified and available to students.')}
                />
                <IconButton
                  icon={Power}
                  aria-label={`${resource.active ? 'Deactivate' : 'Activate'} resource ${resource.title}`}
                  disabled={busy}
                  onClick={() => void runMutation(() => updateAdminLearningResource(resource.id, { active: !resource.active }), resource.active ? 'Resource deactivated.' : 'Resource activated.')}
                />
              </>
            )}
          />
        </section>
      )}

      {tab === 'paths' && (
        <section className="space-y-5">
          <form onSubmit={(event) => void submitPath(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <h2 className="text-lg font-bold md:col-span-2">{editingPath === null ? 'Create learning path' : `Edit learning path #${editingPath}`}</h2>
            {editingPath === null && <label className="text-sm font-medium">Slug<input required pattern="[a-z0-9-]+" minLength={2} maxLength={100} className={inputClass} value={pathDraft.slug ?? ''} onChange={(event) => setPathDraft({ ...pathDraft, slug: event.target.value })} /></label>}
            <label className="text-sm font-medium">Title<input required minLength={2} maxLength={180} className={inputClass} value={pathDraft.title} onChange={(event) => setPathDraft({ ...pathDraft, title: event.target.value })} /></label>
            <label className="text-sm font-medium">Category<select required className={inputClass} value={pathDraft.category_id || ''} onChange={(event) => setPathDraft({ ...pathDraft, category_id: Number(event.target.value) })}><option value="">Choose category</option>{categories.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <label className="text-sm font-medium md:col-span-2">Description<textarea required minLength={5} maxLength={5000} className={inputClass} rows={2} value={pathDraft.description} onChange={(event) => setPathDraft({ ...pathDraft, description: event.target.value })} /></label>
            <label className="text-sm font-medium">Role tags<input className={inputClass} value={pathTags.roles} onChange={(event) => setPathTags({ ...pathTags, roles: event.target.value })} /></label>
            <label className="text-sm font-medium">Topic tags<input className={inputClass} value={pathTags.topics} onChange={(event) => setPathTags({ ...pathTags, topics: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pathDraft.active} onChange={(event) => setPathDraft({ ...pathDraft, active: event.target.checked })} />Active</label>
            <fieldset className="space-y-2 md:col-span-2"><legend className="text-sm font-semibold">Ordered resources (shown in selection order)</legend><div className="grid gap-2 sm:grid-cols-2">{resources.map((resource) => <label key={resource.id} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${!resource.active || !resource.verified_at ? 'opacity-50' : ''}`}><input type="checkbox" disabled={!resource.active || !resource.verified_at} checked={pathDraft.resources.some((item) => item.resource_id === resource.id)} onChange={() => toggleResource(resource.id)} />{resource.title}{!resource.verified_at && <span className="text-xs text-amber-700">unverified</span>}</label>)}</div></fieldset>
            <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy} leftIcon={editingPath === null ? <Plus className="h-4 w-4" /> : undefined}>{editingPath === null ? 'Create path' : 'Save path'}</Button>{editingPath !== null && <Button type="button" variant="secondary" onClick={() => { setEditingPath(null); setPathDraft(blankPath()); setPathTags({ roles: '', topics: '' }) }}>Cancel edit</Button>}</div>
          </form>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Learning paths ({paths.length})</h3>
          <DataList
            ariaLabel="Learning paths"
            rows={paths}
            getRowKey={(path) => path.id}
            emptyState="No learning paths are configured."
            columns={[
              { key: 'path', header: 'Learning path', render: (path) => <div><p className="font-semibold">{path.title}</p><p className="mt-1 text-xs text-slate-500">{path.slug}</p></div> },
              { key: 'resources', header: 'Resources', render: (path) => <span>{path.resources.length} total · {path.resources.filter((resource) => resource.active && resource.verified).length} usable</span> },
              { key: 'state', header: 'State', render: (path) => <Badge variant={path.active ? 'emerald' : 'slate'}>{path.active ? 'Active' : 'Inactive'}</Badge> },
            ]}
            actions={(path) => <IconButton icon={Pencil} aria-label={`Edit learning path ${path.title}`} onClick={() => editPath(path)} />}
          />
        </section>
      )}

      {tab === 'categories' && (
        <section className="space-y-5">
          <form onSubmit={(event) => void submitCategory(event)} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
            <h2 className="text-lg font-bold md:col-span-2">{editingCategory === null ? 'Add category' : `Edit category #${editingCategory}`}</h2>
            {editingCategory === null && <label className="text-sm font-medium">Slug<input required pattern="[a-z0-9-]+" minLength={2} maxLength={80} className={inputClass} value={categoryDraft.slug} onChange={(event) => setCategoryDraft({ ...categoryDraft, slug: event.target.value })} /></label>}
            <label className="text-sm font-medium">Title<input required minLength={2} maxLength={120} className={inputClass} value={categoryDraft.title} onChange={(event) => setCategoryDraft({ ...categoryDraft, title: event.target.value })} /></label>
            <label className="text-sm font-medium">Description<textarea maxLength={1000} className={inputClass} rows={2} value={categoryDraft.description} onChange={(event) => setCategoryDraft({ ...categoryDraft, description: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={categoryDraft.active} onChange={(event) => setCategoryDraft({ ...categoryDraft, active: event.target.checked })} />Active</label>
            <div className="flex gap-2"><Button type="submit" disabled={busy} leftIcon={editingCategory === null ? <Plus className="h-4 w-4" /> : undefined}>{editingCategory === null ? 'Add category' : 'Save changes'}</Button>{editingCategory !== null && <Button type="button" variant="secondary" onClick={() => { setEditingCategory(null); setCategoryDraft({ slug: '', title: '', description: '', active: true }) }}>Cancel</Button>}</div>
          </form>
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Categories ({categories.length})</h3>
          <DataList
            ariaLabel="Learning categories"
            rows={categories}
            getRowKey={(category) => category.id}
            emptyState="No learning categories are configured."
            columns={[
              { key: 'category', header: 'Category', render: (category) => <div><p className="font-semibold">{category.title}</p><p className="mt-1 text-xs text-slate-500">{category.slug}</p></div> },
              { key: 'state', header: 'State', render: (category) => <Badge variant={category.active ? 'emerald' : 'slate'}>{category.active ? 'Active' : 'Inactive'}</Badge> },
            ]}
            actions={(category) => (
              <>
                <IconButton
                  icon={Pencil}
                  aria-label={`Edit category ${category.title}`}
                  onClick={() => { setEditingCategory(category.id); setCategoryDraft({ slug: category.slug, title: category.title, description: category.description, active: category.active }) }}
                />
                <IconButton
                  icon={Power}
                  aria-label={`${category.active ? 'Deactivate' : 'Activate'} category ${category.title}`}
                  disabled={busy}
                  onClick={() => void runMutation(() => updateAdminLearningCategory(category.id, { active: !category.active }), category.active ? 'Category deactivated.' : 'Category activated.')}
                />
              </>
            )}
          />
        </section>
      )}

      {tab === 'audit' && (
        <>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Audit log ({audit.length})</h2>
          <DataList
            ariaLabel="Learning Library audit log"
            rows={audit}
            getRowKey={(entry, index) => `${String(entry.id ?? entry.action)}-${index}`}
            emptyState="No learning library changes have been recorded."
            columns={[
              { key: 'when', header: 'When', render: (entry) => typeof entry.created_at === 'string' ? new Date(entry.created_at).toLocaleString() : '—' },
              { key: 'action', header: 'Action', render: (entry) => eventSummary(entry.action) },
              { key: 'entity', header: 'Entity', render: (entry) => `${eventSummary(entry.entity_type)} #${eventSummary(entry.entity_id)}` },
              { key: 'summary', header: 'Summary', render: (entry) => <span className="break-words">{eventSummary(entry.summary ?? entry.after_summary ?? entry.details)}</span> },
            ]}
          />
        </>
      )}
    </main>
  )
}
