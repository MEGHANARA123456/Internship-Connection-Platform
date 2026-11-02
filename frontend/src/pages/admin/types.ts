export type AdminPage<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type AdminStudent = {
  user_id: number
  full_name: string | null
  email: string
  university: string | null
  major: string | null
  graduation_year: number | null
  skills: string[]
  is_verified: boolean
  suspended_at: string | null
  created_at: string
  applications_count: number
  badges_count: number
  avatar_url: string | null
}

export type AdminCompany = {
  user_id: number
  company_name: string
  industry: string
  location: string | null
  company_size: string | null
  verification_status: string
  posting_count: number
  active_roles: number
  total_applicants: number
  created_at: string
  suspended_at: string | null
}

export type AdminAccount = {
  user_id: number
  email: string
  is_active: boolean
  is_verified: boolean
  mfa_enabled: boolean
  suspended_at: string | null
  created_at: string
}

export type AdminAuditEvent = {
  id: number
  action: string
  actor_email: string | null
  created_at: string
}

export type AdminStudentDetail = {
  account: AdminAccount
  profile: {
    full_name: string
    university: string
    major: string
    graduation_year: number
    bio: string | null
    skills: string
    institution_email: string | null
    avatar_url: string | null
    show_verified_badges: boolean
  } | null
  applications: Array<{
    id: number
    internship_title: string
    company_name: string
    status: string
    created_at: string
  }>
  applications_total: number
  interviews: Array<{
    date: string
    status: string
    internship_title: string
    company_name: string
  }>
  assessment_attempts: Array<{
    topic: string
    score: number | null
    passed: boolean | null
    submitted_at: string
  }>
  badges: Array<{
    topic: string
    title: string
    level: string
    score: number
    issued_at: string
    expires_at: string
    valid: boolean
  }>
  recent_audit_events: AdminAuditEvent[]
}

export type AdminCompanyDetail = {
  account: AdminAccount
  profile: {
    company_name: string
    industry: string
    website: string | null
    description: string | null
    company_size: string | null
    location: string | null
    recruiter_contact_name: string | null
    recruiter_contact_phone: string | null
    recruiter_contact_email: string | null
    verification_status: string
    verification_note: string | null
  }
  documents: Array<{
    id: number
    document_type: string
    original_filename: string
    file_size: number
    uploaded_at: string
  }>
  postings: Array<{
    id: number
    title: string
    status: string
    deadline: string
    applicant_count: number
    created_at: string
  }>
  postings_total: number
  metrics: {
    active_roles: number
    total_internships: number
    total_applicants: number
    shortlisted: number
    interviews_scheduled: number
    offers: number
  }
  verification_history: Array<{
    action: string
    actor_email: string | null
    date: string
    reason: string | null
  }>
  recent_audit_events: AdminAuditEvent[]
}
