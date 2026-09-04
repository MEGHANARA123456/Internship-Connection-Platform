import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'

export function ProfilePage({ company = false }: { company?: boolean }) {
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await api.put(`/profiles/${company ? 'company' : 'student'}`, Object.fromEntries(new FormData(event.currentTarget)))
    setMessage('Profile saved.')
  }
  return <section className="auth-panel"><p className="eyebrow">Profile</p><h1>{company ? 'Company profile' : 'Student profile'}</h1><form onSubmit={submit}>{company ? <><label>Company name<input name="company_name" required /></label><label>Industry<input name="industry" required /></label><label>Website<input name="website" /></label><label>Description<textarea name="description" /></label><label>Verification status<select name="verification_status" defaultValue="PENDING"><option>PENDING</option><option>VERIFIED</option><option>REJECTED</option></select></label></> : <><label>Full name<input name="full_name" required /></label><label>University<input name="university" required /></label><label>Major<input name="major" required /></label><label>Graduation year<input name="graduation_year" type="number" required /></label><label>Bio<textarea name="bio" /></label></>}<button className="primary-action" type="submit">Save profile</button>{message && <p className="form-message">{message}</p>}</form>{!company && <ResumeWidget />}</section>
}

function ResumeWidget() {
  const [message, setMessage] = useState('')
  const session = useAuthStore((state) => state.session)
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); await api.post('/profiles/student/resume', form, { headers: { Authorization: `Bearer ${session?.accessToken}` } }); setMessage('Resume uploaded.')
  }
  return <div className="resume-widget"><p className="eyebrow">Resume</p><form onSubmit={upload}><input name="file" type="file" accept=".pdf,.doc,.docx" required /><button className="secondary-action" type="submit">Upload or replace</button>{message && <p className="form-message">{message}</p>}</form></div>
}
