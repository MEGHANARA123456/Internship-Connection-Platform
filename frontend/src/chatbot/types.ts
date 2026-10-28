export type ChatRole = 'user' | 'assistant'
export type ChatSourceType = 'docs' | 'live data' | 'docs + live data'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  links?: Array<{ label: string; route: string }>
  sources?: Array<{ id: string; title: string; route: string }>
  sourceType?: ChatSourceType
  suggestedFollowups?: string[]
  noEvidence?: boolean
  summary?: PersonalSummary
}

export interface PersonalSummary {
  title: string
  items: Array<{ label: string; value: number }>
  link: { label: string; route: string }
}

export interface ChatResponse {
  answer: string
  links: Array<{ label: string; route: string }>
  sources: Array<{ id: string; title: string; route: string }>
  source_type: ChatSourceType
  suggested_followups: string[]
  category: string
  refused: boolean
}

export type ChatPage =
  | 'home'
  | 'student-dashboard'
  | 'opportunities'
  | 'applications'
  | 'profile'
  | 'interviews'
  | 'messages'
  | 'notifications'
  | 'company'
  | 'company-dashboard'
  | 'company-jobs'
  | 'company-applicants'
  | 'company-analytics'
  | 'company-shortlisted'
  | 'company-pipeline'
  | 'company-settings'
  | 'company-profile'
  | 'admin'
  | 'admin-dashboard'
  | 'admin-moderation'
  | 'admin-skills'
  | 'admin-verifications'
  | 'admin-reports'
  | 'admin-audit-logs'
  | 'admin-companies'
  | 'admin-users'
  | 'privacy'
  | 'privacy-policy'
  | 'privacy-center'
  | 'saved'
  | 'login'
  | 'register-student'
  | 'register-company'
  | 'verify'

export interface ChatbotStatus {
  enabled: boolean
  mode: 'retrieval' | 'llm'
  provider_configured: boolean
  rag_enabled: boolean
  indexed_chunk_count: number
  last_indexed_at: string | null
}
