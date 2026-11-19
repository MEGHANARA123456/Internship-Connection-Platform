import { api } from '../api/client'
import type { SkillAssessmentInsight, SkillGapOptions, SkillGapReport } from '../types/skillGap'

export async function getSkillGapOptions(): Promise<SkillGapOptions> {
  const response = await api.get<SkillGapOptions>('/skill-gaps/options')
  return response.data
}

export async function listSkillGapReports(): Promise<SkillGapReport[]> {
  const response = await api.get<SkillGapReport[]>('/skill-gaps/reports')
  return response.data
}

export async function createSkillGapReport(
  target: { target_role: string } | { internship_id: number },
): Promise<SkillGapReport> {
  const response = await api.post<SkillGapReport>('/skill-gaps/reports', target)
  return response.data
}

export async function getSkillGapReport(reportId: number): Promise<SkillGapReport> {
  const response = await api.get<SkillGapReport>(`/skill-gaps/reports/${reportId}`)
  return response.data
}

export async function listSkillAssessmentInsights(): Promise<SkillAssessmentInsight[]> {
  const { data } = await api.get<Array<{
    id: number
    topic: string
    weighted_percentage: number | null
    submitted_at: string | null
    subtopic_scores: SkillAssessmentInsight['subtopic_scores']
  }>>('/skills/attempts')
  const latestByTopic = new Map<string, typeof data[number]>()
  for (const attempt of data) {
    if (!attempt.submitted_at) continue
    const previous = latestByTopic.get(attempt.topic)
    if (!previous || (previous.submitted_at ?? '') < attempt.submitted_at) {
      latestByTopic.set(attempt.topic, attempt)
    }
  }
  return Promise.all([...latestByTopic.values()].map(async (attempt) => {
    const result = await api.get<SkillAssessmentInsight>(`/skills/assessments/${attempt.id}/result`)
    return {
      ...result.data,
      weighted_percentage: Number(attempt.weighted_percentage ?? result.data.weighted_percentage ?? 0),
      submitted_at: attempt.submitted_at ?? result.data.submitted_at,
    }
  }))
}
