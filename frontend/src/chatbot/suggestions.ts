import type { UserRole } from '../store/auth'
import type { ChatPage } from './types'

const GUEST_SUGGESTIONS = [
  'What is InternSphere?',
  'How do I register?',
  'How do I verify my email?',
  'How do I sign in?',
]

const ROLE_SUGGESTIONS: Record<UserRole, string[]> = {
  STUDENT: [
    'Find internships matching my profile.',
    'Show my application status.',
    'Help me prepare for an interview.',
    'How can I improve my resume?',
  ],
  COMPANY: [
    'Help me create an internship posting.',
    'Summarize my applicants.',
    'Explain my hiring pipeline.',
    'Show my recruitment activity.',
  ],
  ADMIN: [
    'Summarize platform activity.',
    'Explain recent audit events.',
    'Help me verify a company.',
    'How do I manage platform users?',
  ],
}

const ROLE_GREETINGS: Record<UserRole, string> = {
  STUDENT: "Hi! I'm InternSphere AI. I can help you discover internships, track applications, and prepare for your career. What would you like help with?",
  COMPANY: 'Welcome to InternSphere AI. I can help you manage internship postings, review applicants, and navigate your hiring workflow.',
  ADMIN: "Hello! I'm InternSphere AI. I can help you navigate platform administration, analytics, verification, and audit tools.",
}

export function greetingForRole(role: UserRole | undefined): string {
  return role
    ? ROLE_GREETINGS[role]
    : "Hi! I'm InternSphere AI. Ask me how to use the platform."
}

export function suggestedQuestions(role: UserRole | undefined): string[] {
  return role ? ROLE_SUGGESTIONS[role] : GUEST_SUGGESTIONS
}

const PAGE_SUGGESTIONS: Partial<Record<ChatPage, Partial<Record<UserRole, string[]>>>> = {
  applications: {
    STUDENT: ['How do I read my application timeline?', 'What do the application statuses mean?'],
  },
  'company-applicants': {
    COMPANY: ['How do I move a candidate to the next stage?', 'How do I review verified skill badges?'],
  },
  'company-jobs': {
    COMPANY: ['How do I publish or close a role?', 'How do applicants reach my posting?'],
  },
  'admin-moderation': {
    ADMIN: ['How do I review a moderation report?', 'Where can I see the audit trail?'],
  },
  'admin-skills': {
    ADMIN: ['How do I manage assessment questions?', 'How are verified skill badges awarded?'],
  },
}

export function suggestedQuestionsForPage(
  role: UserRole | undefined,
  page: ChatPage,
): string[] {
  if (!role) return GUEST_SUGGESTIONS
  return PAGE_SUGGESTIONS[page]?.[role] ?? ROLE_SUGGESTIONS[role]
}
