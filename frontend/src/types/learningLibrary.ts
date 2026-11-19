export type LearningSection =
  | 'LEARNING_PATHS'
  | 'INTERVIEW_QUESTIONS'
  | 'CODING_PRACTICE'
  | 'COURSES'
  | 'PRACTICE_TESTS'
  | 'MY_PROGRESS'

export type LearningResource = {
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
  verified_at: string | null
  progress: 'VIEWED' | 'COMPLETED' | null
  bookmarked: boolean
  position?: number
  viewed_at?: string
  completed_at?: string | null
}

export type LearningPath = {
  id: number
  slug: string
  category: string | null
  title: string
  description: string
  role_tags: string[]
  topic_tags: string[]
  resource_count: number
  completed_count: number
  progress_percent: number
  resources: LearningResource[]
}

export type LearningCategory = {
  id: number
  slug: string
  title: string
  description: string
}

export type LearningRecommendations = {
  target_role: string | null
  weakest_skill: string | null
  resources: LearningResource[]
  paths: Array<Pick<LearningPath, 'id' | 'slug' | 'title' | 'description'>>
}

export type LearningProgress = {
  viewed_count: number
  completed_count: number
  items: LearningResource[]
}
