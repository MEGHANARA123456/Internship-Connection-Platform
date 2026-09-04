import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

const auth = () => ({ headers: { Authorization: `Bearer ${useAuthStore.getState().session?.accessToken}` } })
type Application = { id: number; internship_id: number; student_id: number; status: string; student_name?: string; student_university?: string; student_skills: string[]; resume_id?: number; cover_note?: string }

export function ApplicationDashboardPage() {
  const [data, setData] = useState<{ counts: Record<string, number>; applications: Application[] }>({ counts: {}, applications: [] })
  useEffect(() => { api.get('/applications/mine', auth()).then(response => setData(response.data)) }, [])
  return <section className="listing"><aside className="filter-sidebar"><p className="eyebrow">My applications</p><h2>Keep every opportunity in view.</h2>{Object.entries(data.counts).map(([status, count]) => <p key={status}>{status.replace('_', ' ')} · {count}</p>)}</aside><div className="results">{data.applications.map(application => <article className="internship-item" key={application.id}><h2>Internship #{application.internship_id}</h2><p>{application.status.replace('_', ' ')}</p></article>)}</div></section>
}

export function CompanyReviewPage() {
  const { internshipId } = useParams(); const [applications, setApplications] = useState<Application[]>([])
  function load() { api.get(`/applications/internships/${internshipId}`, auth()).then(response => setApplications(response.data)) }
  useEffect(load, [internshipId])
  async function update(id: number, status: string) { await api.patch(`/applications/${id}/status`, { status }, auth()); load() }
  return <section className="listing"><aside className="filter-sidebar"><p className="eyebrow">Company review</p><h2>Applicants</h2></aside><div className="results">{applications.map(application => <article className="internship-item" key={application.id}><h2>{application.student_name ?? `Student #${application.student_id}`}</h2><p>{application.student_university} · {application.student_skills.join(' · ')}</p><p>Status: {application.status}</p>{application.resume_id && <a href={`${import.meta.env.VITE_API_BASE_URL}/profiles/resume/${application.resume_id}/download`} target="_blank">View resume</a>}<div className="actions"><button className="secondary-action" onClick={() => update(application.id, 'UNDER_REVIEW')}>Review</button><button className="secondary-action" onClick={() => update(application.id, 'SHORTLISTED')}>Shortlist</button><button className="secondary-action" onClick={() => update(application.id, 'REJECTED')}>Reject</button><button className="primary-action" onClick={() => update(application.id, 'SELECTED')}>Select</button></div></article>)}</div></section>
}