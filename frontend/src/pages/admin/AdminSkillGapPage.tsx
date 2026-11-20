import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { Button } from '../../components/ui/Button'

interface SkillEntry {
  id: number
  canonical_name: string
  aliases: string[]
}

interface RoleEntry {
  slug: string
  label: string
  requirements: Array<{
    skill_id: number
    canonical_name: string
    aliases: string[]
    requirement_type: 'required' | 'preferred'
  }>
}

export function AdminSkillGapPage() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [roles, setRoles] = useState<RoleEntry[]>([])
  const [selectedRole, setSelectedRole] = useState('')
  const [roleSkills, setRoleSkills] = useState<Record<number, 'required' | 'preferred'>>({})
  const [edits, setEdits] = useState<Record<number, { name: string; aliases: string }>>({})
  const [newName, setNewName] = useState('')
  const [newAliases, setNewAliases] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [skillResponse, roleResponse] = await Promise.all([
        api.get<SkillEntry[]>('/admin/skill-gaps/skills'),
        api.get<RoleEntry[]>('/admin/skill-gaps/roles'),
      ])
      setSkills(skillResponse.data)
      setRoles(roleResponse.data)
      setEdits(Object.fromEntries(skillResponse.data.map((skill) => [
        skill.id,
        { name: skill.canonical_name, aliases: skill.aliases.join(', ') },
      ])))
      setSelectedRole((current) => current || roleResponse.data[0]?.slug || '')
    } catch {
      setError('Could not load the skill catalog. Retry to continue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const currentRole = roles.find((role) => role.slug === selectedRole)
  useEffect(() => {
    setRoleSkills(Object.fromEntries(
      (currentRole?.requirements ?? []).map((item) => [item.skill_id, item.requirement_type]),
    ))
  }, [selectedRole, roles])

  const saveSkill = async (skill: SkillEntry) => {
    const edit = edits[skill.id]
    if (!edit?.name.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/skill-gaps/skills/${skill.id}`, {
        canonical_name: edit.name.trim(),
        aliases: edit.aliases.split(',').map((alias) => alias.trim()).filter(Boolean),
      })
      setNotice(`Updated ${edit.name.trim()}.`)
      await load()
    } catch {
      setError('Could not save this skill. Check that the canonical name is unique.')
    } finally {
      setBusy(false)
    }
  }

  const addSkill = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/admin/skill-gaps/skills', {
        canonical_name: newName.trim(),
        aliases: newAliases.split(',').map((alias) => alias.trim()).filter(Boolean),
      })
      setNewName('')
      setNewAliases('')
      setNotice('Added skill. Assign it to a role to include it in analysis.')
      await load()
    } catch {
      setError('Could not add this skill. Check that the name is unique and complete.')
    } finally {
      setBusy(false)
    }
  }

  const saveRole = async () => {
    if (!currentRole) return
    setBusy(true)
    setError('')
    try {
      await api.put(`/admin/skill-gaps/roles/${currentRole.slug}`, {
        role_label: currentRole.label,
        requirements: Object.entries(roleSkills).map(([skill_id, requirement_type]) => ({
          skill_id: Number(skill_id),
          requirement_type,
        })),
      })
      setNotice(`Saved requirements for ${currentRole.label}.`)
      await load()
    } catch {
      setError('Could not save this role map. Include at least one skill and avoid duplicates.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Admin tools</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">Skill Gap Catalog</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Manage canonical skills, aliases, and role requirements. Changes are audit logged; student reports are not accessible here.</p>
      </header>

      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</p>}
      {loading ? <p role="status">Loading skill catalog…</p> : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="text-sm font-semibold">Role map
                <select aria-label="Role map" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
                  {roles.map((role) => <option key={role.slug} value={role.slug}>{role.label}</option>)}
                </select>
              </label>
              <Button onClick={() => void saveRole()} disabled={busy || !currentRole}>Save role requirements</Button>
            </div>
            {currentRole && (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {skills.map((skill) => (
                  <label key={skill.id} className="flex items-center gap-2 rounded-lg border border-slate-100 p-2 text-sm dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={Boolean(roleSkills[skill.id])}
                      onChange={(event) => setRoleSkills((current) => {
                        const next = { ...current }
                        if (event.target.checked) next[skill.id] = 'required'
                        else delete next[skill.id]
                        return next
                      })}
                    />
                    <span className="min-w-0 flex-1">{skill.canonical_name}</span>
                    {roleSkills[skill.id] && (
                      <select
                        aria-label={`${skill.canonical_name} requirement type`}
                        value={roleSkills[skill.id]}
                        onChange={(event) => setRoleSkills((current) => ({
                          ...current,
                          [skill.id]: event.target.value as 'required' | 'preferred',
                        }))}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value="required">Required</option><option value="preferred">Preferred</option>
                      </select>
                    )}
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold">Canonical skills and aliases</h2>
            <form onSubmit={addSkill} className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input aria-label="New canonical skill" required minLength={2} maxLength={100} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Canonical skill name" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
              <input aria-label="New skill aliases" value={newAliases} onChange={(event) => setNewAliases(event.target.value)} placeholder="Aliases, comma separated" className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
              <Button type="submit" disabled={busy}>Add skill</Button>
            </form>
            <ul className="mt-4 space-y-2">
              {skills.map((skill) => (
                <li key={skill.id} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_2fr_auto] dark:border-slate-800">
                  <input aria-label={`${skill.canonical_name} canonical name`} value={edits[skill.id]?.name ?? skill.canonical_name} onChange={(event) => setEdits((current) => ({ ...current, [skill.id]: { ...current[skill.id], name: event.target.value } }))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                  <input aria-label={`${skill.canonical_name} aliases`} value={edits[skill.id]?.aliases ?? skill.aliases.join(', ')} onChange={(event) => setEdits((current) => ({ ...current, [skill.id]: { ...current[skill.id], aliases: event.target.value } }))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
                  <Button variant="outline" disabled={busy} onClick={() => void saveSkill(skill)}>Save</Button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
