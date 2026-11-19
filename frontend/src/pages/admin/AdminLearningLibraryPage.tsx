import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
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
            <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy}>{editingResource === null ? 'Add resource' : 'Save changes'}</Button>{editingResource !== null && <Button type="button" variant="secondary" onClick={() => { setEditingResource(null); setResourceDraft(blankResource()); setResourceTags({ roles: '', topics: '' }) }}>Cancel edit</Button>}</div>
          </form>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800"><tr><th className="p-3">Resource</th><th className="p-3">Category</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>
              {resources.map((resource) => <tr key={resource.id} className="border-t border-slate-200 dark:border-slate-800"><td className="p-3"><strong>{resource.title}</strong><p className="max-w-md truncate text-xs text-slate-500">{resource.url}</p></td><td className="p-3">{resource.category ?? '—'}</td><td className="p-3">{resource.active ? 'Active' : 'Inactive'} · {resource.verified_at ? 'Verified' : 'Unverified'}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => startEditResource(resource)}>Edit</Button><Button size="sm" variant="secondary" disabled={busy || !resource.active || Boolean(resource.verified_at)} onClick={() => void runMutation(() => verifyAdminLearningResource(resource.id), 'Resource verified and available to students.')}>Verify</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void runMutation(() => updateAdminLearningResource(resource.id, { active: !resource.active }), resource.active ? 'Resource deactivated.' : 'Resource activated.')}>{resource.active ? 'Deactivate' : 'Activate'}</Button></div></td></tr>)}
              {!resources.length && <tr><td className="p-4 text-slate-500" colSpan={4}>No resources yet.</td></tr>}
            </tbody></table>
          </div>
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
            <div className="flex gap-2 md:col-span-2"><Button type="submit" disabled={busy}>{editingPath === null ? 'Create path' : 'Save path'}</Button>{editingPath !== null && <Button type="button" variant="secondary" onClick={() => { setEditingPath(null); setPathDraft(blankPath()); setPathTags({ roles: '', topics: '' }) }}>Cancel edit</Button>}</div>
          </form>
          <div className="grid gap-3 md:grid-cols-2">{paths.map((path) => <article key={path.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{path.title}</h3><p className="mt-1 text-sm text-slate-500">{path.resources.length} resources · {path.active ? 'Active' : 'Inactive'}</p><p className="mt-1 text-xs text-slate-500">{path.resources.filter((resource) => resource.active && resource.verified).length}/{path.resources.length} usable</p></div><Button size="sm" variant="secondary" onClick={() => editPath(path)}>Edit</Button></div></article>)}</div>
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
            <div className="flex gap-2"><Button type="submit" disabled={busy}>{editingCategory === null ? 'Add category' : 'Save changes'}</Button>{editingCategory !== null && <Button type="button" variant="secondary" onClick={() => { setEditingCategory(null); setCategoryDraft({ slug: '', title: '', description: '', active: true }) }}>Cancel</Button>}</div>
          </form>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase dark:bg-slate-800"><tr><th className="p-3">Category</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id} className="border-t dark:border-slate-800"><td className="p-3"><strong>{category.title}</strong><p className="text-xs text-slate-500">{category.slug}</p></td><td className="p-3">{category.active ? 'Active' : 'Inactive'}</td><td className="p-3"><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setEditingCategory(category.id); setCategoryDraft({ slug: category.slug, title: category.title, description: category.description, active: category.active }) }}>Edit</Button><Button size="sm" variant="secondary" onClick={() => void runMutation(() => updateAdminLearningCategory(category.id, { active: !category.active }), category.active ? 'Category deactivated.' : 'Category activated.')}>{category.active ? 'Deactivate' : 'Activate'}</Button></div></td></tr>)}</tbody></table></div>
        </section>
      )}

      {tab === 'audit' && (
        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase dark:bg-slate-800"><tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3">Summary</th></tr></thead><tbody>
            {audit.map((entry, index) => <tr key={`${String(entry.id ?? entry.action)}-${index}`} className="border-t dark:border-slate-800"><td className="p-3">{typeof entry.created_at === 'string' ? new Date(entry.created_at).toLocaleString() : '—'}</td><td className="p-3">{eventSummary(entry.action)}</td><td className="p-3">{eventSummary(entry.entity_type)} #{eventSummary(entry.entity_id)}</td><td className="max-w-lg truncate p-3">{eventSummary(entry.summary ?? entry.after_summary ?? entry.details)}</td></tr>)}
            {!audit.length && <tr><td colSpan={4} className="p-4 text-slate-500">No learning library changes have been recorded.</td></tr>}
          </tbody></table>
        </section>
      )}
    </main>
  )
}
