import type { UserRole } from '../store/auth'
import type { ChatPage } from './types'

const GUEST_SUGGESTIONS = [
  'How do I register?',
  'How do I search internships?',
  'How does InternSphere work?',
]

const ROLE_SUGGESTIONS: Record<UserRole, string[]> = {
  STUDENT: [
    'Find internships matching my profile.',
    'How many applications do I have?',
    'Any interviews?',
    'How do I take a skill assessment?',
  ],
  COMPANY: [
    'My active postings',
    'How many applicants do I have?',
    'How many shortlisted candidates do I have?',
    'How do I schedule an interview?',
  ],
  ADMIN: [
    'How do I review pending postings?',
    'Show company verification counts.',
    'How many topics in skill assessment?',
    'Explain recent audit events.',
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
    STUDENT: ['How many applications do I have?', 'How do I track my applications?'],
  },
  'company-applicants': {
    COMPANY: ['How do I review applicants?', 'How many shortlisted candidates do I have?'],
  },
  'company-jobs': {
    COMPANY: ['How do I create an internship posting?', 'My active postings'],
  },
  'admin-moderation': {
    ADMIN: ['How do I review pending postings?', 'Explain recent audit events.'],
  },
  'admin-skills': {
    ADMIN: ['How do I manage assessment questions?', 'How do I import assessment questions?'],
  },
}

export function suggestedQuestionsForPage(
  role: UserRole | undefined,
  page: ChatPage,
): string[] {
  if (!role) return GUEST_SUGGESTIONS
  return PAGE_SUGGESTIONS[page]?.[role] ?? ROLE_SUGGESTIONS[role]
}
