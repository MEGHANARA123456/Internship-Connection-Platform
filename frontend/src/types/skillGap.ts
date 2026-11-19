export interface SkillGapOptions {
  roles: Array<{ slug: string; label: string }>
  internships: Array<{ id: number; title: string; skills: string[] }>
}

export interface SkillGapSuggestion {
  skill: string
  priority: number
  message: string
  resource: {
    id: number
    title: string
    url: string
    type: string
  }
}

export interface SkillGapReport {
  id: number
  target_type: 'ROLE' | 'INTERNSHIP'
  target_id: number | null
  target_label: string
  estimated_match_score: number | null
  created_at: string
  matched_skills: string[]
  missing_required_skills: string[]
  missing_preferred_skills: string[]
  weak_skills: Array<{ name: string; score: number }>
  skills_to_learn: Array<{ skill: string; priority: number }>
  learning_suggestions: SkillGapSuggestion[]
  resume_tips: string[]
}

export interface SkillAssessmentInsight {
  attempt_id: number
  topic: string
  weighted_percentage: number
  submitted_at: string
  subtopic_scores: Record<string, { earned: number; possible: number; percentage: number }>
  weak_subtopics: Array<{
    subtopic: string
    tip: string
    learning_links: Array<{ title: string; url: string }>
  }>
}
