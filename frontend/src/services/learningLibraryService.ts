import { api } from '../api/client'
import type {
  LearningCategory,
  LearningPath,
  LearningProgress,
  LearningRecommendations,
  LearningResource,
} from '../types/learningLibrary'

export async function listLearningCategories() {
  return (await api.get<LearningCategory[]>('/learning/categories')).data
}

export async function listLearningPaths(role?: string) {
  return (await api.get<LearningPath[]>('/learning/paths', {
    params: role ? { role } : undefined,
  })).data
}

export async function getLearningPath(id: number) {
  return (await api.get<LearningPath>(`/learning/paths/${id}`)).data
}

export async function listLearningResources(params: {
  search?: string
  category?: string
  type?: string
  level?: string
  role?: string
  section?: string
  bookmarked?: boolean
} = {}) {
  return (await api.get<{ items: LearningResource[]; total: number }>('/learning/resources', {
    params,
  })).data
}

export async function getLearningProgress() {
  return (await api.get<LearningProgress>('/learning/progress')).data
}

export async function getLearningPreference() {
  return (await api.get<{ target_role: string | null }>('/learning/preferences')).data
}

export async function updateLearningPreference(target_role: string | null) {
  return (await api.patch<{ target_role: string | null }>('/learning/preferences', {
    target_role,
  })).data
}

export async function updateLearningResourceProgress(
  resourceId: number,
  status: 'VIEWED' | 'COMPLETED',
) {
  return (await api.put(`/learning/resources/${resourceId}/progress`, { status })).data
}

export async function setLearningBookmark(resourceId: number, bookmarked: boolean) {
  if (bookmarked) {
    return (await api.put(`/learning/resources/${resourceId}/bookmark`)).data
  }
  return (await api.delete(`/learning/resources/${resourceId}/bookmark`)).data
}

export async function getLearningRecommendations(target_role?: string | null) {
  return (await api.get<LearningRecommendations>('/learning/recommendations', {
    params: target_role ? { target_role } : undefined,
  })).data
}

