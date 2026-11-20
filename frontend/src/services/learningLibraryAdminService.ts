import { api } from '../api/client'

export type AdminLearningCategory = {
  id: number
  slug: string
  title: string
  description: string
  active: boolean
}

export type AdminLearningResource = {
  id: number
  slug: string
  category_id: number
  category: string | null
  title: string
  description: string
  url: string
  type: 'link' | 'video' | 'pdf' | 'notes' | 'course'
  level: 'ALL' | 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  role_tags: string[]
  topic_tags: string[]
  active: boolean
  verified_at: string | null
}

export type AdminLearningPath = {
  id: number
  slug: string
  category_id: number
  title: string
  description: string
  role_tags: string[]
  topic_tags: string[]
  active: boolean
  resources: Array<{
    resource_id: number
    position: number
    title: string
    active: boolean
    verified: boolean
  }>
}

export type LearningCategoryInput = {
  slug: string
  title: string
  description: string
  active: boolean
}

export type LearningResourceInput = {
  slug?: string
  category_id: number
  title: string
  description: string
  url: string
  resource_type: AdminLearningResource['type']
  level: AdminLearningResource['level']
  role_tags: string[]
  topic_tags: string[]
  active: boolean
}

export type LearningPathInput = {
  slug?: string
  category_id: number
  title: string
  description: string
  role_tags: string[]
  topic_tags: string[]
  active: boolean
  resources: Array<{ resource_id: number }>
}

export async function listAdminLearningCategories() {
  return (await api.get<AdminLearningCategory[]>('/admin/learning/categories')).data
}

export async function createAdminLearningCategory(payload: LearningCategoryInput) {
  return (await api.post<AdminLearningCategory>('/admin/learning/categories', payload)).data
}

export async function updateAdminLearningCategory(
  id: number,
  payload: Partial<Pick<AdminLearningCategory, 'title' | 'description' | 'active'>>,
) {
  return (await api.patch<AdminLearningCategory>(`/admin/learning/categories/${id}`, payload)).data
}

export async function listAdminLearningResources() {
  return (await api.get<AdminLearningResource[]>('/admin/learning/resources')).data
}

export async function createAdminLearningResource(payload: LearningResourceInput) {
  return (await api.post<AdminLearningResource>('/admin/learning/resources', payload)).data
}

export async function updateAdminLearningResource(
  id: number,
  payload: Partial<Omit<LearningResourceInput, 'slug'>>,
) {
  return (await api.patch<AdminLearningResource>(`/admin/learning/resources/${id}`, payload)).data
}

export async function verifyAdminLearningResource(id: number) {
  return (await api.post<AdminLearningResource>(`/admin/learning/resources/${id}/verify`)).data
}

export async function listAdminLearningPaths() {
  return (await api.get<AdminLearningPath[]>('/admin/learning/paths')).data
}

export async function createAdminLearningPath(payload: LearningPathInput) {
  return (await api.post<AdminLearningPath>('/admin/learning/paths', payload)).data
}

export async function updateAdminLearningPath(id: number, payload: LearningPathInput) {
  return (await api.put<AdminLearningPath>(`/admin/learning/paths/${id}`, payload)).data
}

export async function listAdminLearningAudit() {
  return (await api.get<Array<Record<string, unknown>>>('/admin/learning/audit')).data
}
