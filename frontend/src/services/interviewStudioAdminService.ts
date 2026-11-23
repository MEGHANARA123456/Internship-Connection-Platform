import { api } from '../api/client'

const root = '/admin/interview-studio'

export type AdminInterviewQuestion = {
  id: number
  seed_key: string
  category: string
  difficulty: string
  prompt: string
  hint: string
  rubric: string
  active: boolean
  review_status: string
}

export type AdminInterviewTest = {
  id: number
  slug: string
  title: string
  description: string
  category_id: number
  category: string
  difficulty: string
  format: string
  default_mode: string
  question_count: number
  time_limit_seconds: number
  company_style: boolean
  active: boolean
  version: number
  questions: Array<{ id: number; prompt: string; skill_tags: string[] }>
}

export type AdminInterviewSettings = {
  voice_enabled: boolean
  video_enabled: boolean
  recording_enabled: boolean
  retention_days: number
  sessions_per_day: number
  allowed_provider_hosts: string[]
}

export type AdminInterviewProviderStatus = {
  configured: boolean
  provider: string
  model: string
  last_error: string | null
}

export async function listAdminInterviewQuestions(params = {}) {
  return (await api.get<{ items: AdminInterviewQuestion[]; total: number; counts: Record<string, number> }>(
    `${root}/questions`,
    { params },
  )).data
}

export async function createAdminInterviewQuestion(payload: Record<string, unknown>) {
  return (await api.post<AdminInterviewQuestion>(`${root}/questions`, payload)).data
}

export async function updateAdminInterviewQuestion(id: number, payload: Record<string, unknown>) {
  return (await api.patch<AdminInterviewQuestion>(`${root}/questions/${id}`, payload)).data
}

export async function approveAdminInterviewQuestion(id: number) {
  return (await api.post<AdminInterviewQuestion>(`${root}/questions/${id}/approve`)).data
}

export async function importAdminInterviewQuestions(contents: string) {
  return (await api.post<{ imported: number }>(`${root}/questions/import`, contents, {
    headers: { 'Content-Type': 'text/csv' },
  })).data
}

export async function listAdminInterviewTests(category?: string) {
  return (await api.get<{ items: AdminInterviewTest[]; counts: Record<string, number>; total: number }>(
    `${root}/tests`,
    category ? { params: { category } } : undefined,
  )).data
}

export async function createAdminInterviewTest(payload: Record<string, unknown>) {
  return (await api.post<AdminInterviewTest>(`${root}/tests`, payload)).data
}

export async function updateAdminInterviewTest(id: number, payload: Record<string, unknown>) {
  return (await api.put<AdminInterviewTest>(`${root}/tests/${id}`, payload)).data
}

export async function getAdminInterviewTaxonomy() {
  return (await api.get<{
    categories: Array<{ id: number; slug: string; label: string; active: boolean }>
    difficulties: Array<{ code: string; label: string; active: boolean }>
  }>(`${root}/taxonomy`)).data
}

export async function createAdminInterviewCategory(payload: { slug: string; label: string }) {
  return (await api.post(`${root}/taxonomy/categories`, payload)).data
}

export async function updateAdminInterviewCategory(id: number, payload: { label: string; active: boolean }) {
  return (await api.patch(`${root}/taxonomy/categories/${id}`, payload)).data
}

export async function updateAdminInterviewDifficulty(code: string, payload: { label: string; active: boolean }) {
  return (await api.patch(`${root}/taxonomy/difficulties/${encodeURIComponent(code)}`, payload)).data
}

export async function getAdminInterviewSettings() {
  return (await api.get<AdminInterviewSettings>(`${root}/settings`)).data
}

export async function getAdminInterviewProviderStatus() {
  return (await api.get<AdminInterviewProviderStatus>(`${root}/provider-status`)).data
}

export async function updateAdminInterviewSettings(payload: Partial<AdminInterviewSettings>) {
  return (await api.patch<AdminInterviewSettings>(`${root}/settings`, payload)).data
}

export async function getAdminInterviewAnalytics() {
  return (await api.get<Record<string, unknown>>(`${root}/analytics`)).data
}

export async function getAdminInterviewFailures() {
  return (await api.get<Record<string, unknown>>(`${root}/failures`)).data
}

export async function retryAdminInterviewFailures(limit = 10) {
  return (await api.post<{ attempted: number; completed: number; failed: number }>(
    `${root}/failures/retry`,
    null,
    { params: { limit } },
  )).data
}

export async function getAdminInterviewAudit(params: { action?: string; limit?: number; offset?: number } = {}) {
  return (await api.get<Array<Record<string, unknown>>>(`${root}/audit`, { params })).data
}
