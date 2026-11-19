import { useEffect, useState } from 'react'
import { BarChart3, BookOpen, Lightbulb, Target } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card, CardContent } from '../../components/ui/Card'
import {
  createSkillGapReport,
  getSkillGapOptions,
  listSkillAssessmentInsights,
  listSkillGapReports,
} from '../../services/skillGapService'
import type { SkillAssessmentInsight, SkillGapOptions, SkillGapReport } from '../../types/skillGap'

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') {
      if (response.data.detail === 'unknown_target_role') return 'That role is not available. Choose a listed target.'
      if (response.data.detail === 'internship_not_found') return 'That internship is no longer available.'
      return response.data.detail
    }
  }
  return 'Could not load Skill Insights. Check your connection and retry.'
}

function SkillList({ title, skills, emptyText }: { title: string; skills: string[]; emptyText: string }) {
  return (
    <section>
      <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
      {skills.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {skills.map((skill) => (
            <li key={skill} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{skill}</li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-slate-500">{emptyText}</p>}
    </section>
  )
}

export function SkillInsightsPage() {
  const [options, setOptions] = useState<SkillGapOptions | null>(null)
  const [history, setHistory] = useState<SkillGapReport[]>([])
  const [assessmentInsights, setAssessmentInsights] = useState<SkillAssessmentInsight[]>([])
  const [report, setReport] = useState<SkillGapReport | null>(null)
  const [target, setTarget] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([getSkillGapOptions(), listSkillGapReports(), listSkillAssessmentInsights()])
      .then(([nextOptions, nextHistory, nextAssessmentInsights]) => {
        if (!active) return
        setOptions(nextOptions)
        setHistory(nextHistory)
        setAssessmentInsights(nextAssessmentInsights)
        setReport(nextHistory[0] ?? null)
        if (nextOptions.roles.length) setTarget(`role:${nextOptions.roles[0].slug}`)
        else if (nextOptions.internships.length) setTarget(`internship:${nextOptions.internships[0].id}`)
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorText(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const runAnalysis = async () => {
    const [targetType, targetValue] = target.split(':')
    if (!targetValue) return
    setRunning(true)
    setError('')
    try {
      const next = targetType === 'role'
        ? await createSkillGapReport({ target_role: targetValue })
        : await createSkillGapReport({ internship_id: Number(targetValue) })
      setReport(next)
      setHistory((current) => [next, ...current.filter((item) => item.id !== next.id)])
    } catch (requestError) {
      setError(errorText(requestError))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="flex items-center gap-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300"><Lightbulb className="h-4 w-4" />Student tools</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">Skill Insights</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          Compare skills in your profile and resume with a selected role or internship. Results are estimates for your chosen target, not hiring decisions.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            Target role or internship
            <select
              aria-label="Target role or internship"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={loading || running || !options}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <optgroup label="Roles">
                {(options?.roles ?? []).map((role) => <option key={role.slug} value={`role:${role.slug}`}>{role.label}</option>)}
              </optgroup>
              <optgroup label="Published internships">
                {(options?.internships ?? []).map((internship) => <option key={internship.id} value={`internship:${internship.id}`}>{internship.title}</option>)}
              </optgroup>
            </select>
          </label>
          <Button onClick={() => void runAnalysis()} disabled={loading || running || !target} isLoading={running}>
            Analyze skills
          </Button>
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Loading your Skill Insights…</p>}
      {!loading && (
        <section aria-labelledby="assessment-insights-title" className="space-y-3">
          <div>
            <h2 id="assessment-insights-title" className="text-xl font-bold text-slate-900 dark:text-white">Skill assessment insights</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Latest completed score and subtopic breakdown for each assessment topic.</p>
          </div>
          {assessmentInsights.length ? assessmentInsights.map((assessment) => (
            <Card key={assessment.attempt_id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold capitalize text-slate-900 dark:text-white">{assessment.topic.replaceAll('-', ' ')}</h3>
                  <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300">Topic score: {assessment.weighted_percentage}%</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(assessment.subtopic_scores).map(([subtopic, score]) => (
                    <div key={subtopic} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                      <p className="text-sm font-medium capitalize text-slate-800 dark:text-slate-100">{subtopic.replaceAll('-', ' ')}</p>
                      <p className="mt-1 text-xs text-slate-500">{score.percentage}% · {score.earned}/{score.possible} points</p>
                    </div>
                  ))}
                </div>
                {assessment.weak_subtopics.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-amber-800 dark:text-amber-200">Weak subtopics to review</h4>
                    <ul className="mt-2 space-y-3">
                      {assessment.weak_subtopics.map((weak) => (
                        <li key={weak.subtopic} className="rounded-lg border border-amber-200 p-3 dark:border-amber-900">
                          <p className="font-medium capitalize text-slate-900 dark:text-white">{weak.subtopic.replaceAll('-', ' ')}</p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{weak.tip}</p>
                          {weak.learning_links.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {weak.learning_links.map((resource) => (
                                <li key={resource.url}>
                                  <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-indigo-700 underline dark:text-indigo-300">{resource.title}</a>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )) : (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900">Complete a skill assessment to see topic scores, weak subtopics, and study links here.</p>
          )}
        </section>
      )}
      {!loading && !options?.roles.length && !options?.internships.length && (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900">No skill targets are available yet.</p>
      )}

      {report && (
        <>
          <Card>
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Analysis for</p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{report.target_label}</h2>
                  <p className="mt-1 text-xs text-slate-500">Created {new Date(report.created_at).toLocaleString()}</p>
                </div>
                {report.estimated_match_score !== null && (
                  <div className="rounded-xl bg-indigo-50 px-4 py-3 text-right dark:bg-indigo-950/40">
                    <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">Estimated match</p>
                    <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{report.estimated_match_score}/100</p>
                  </div>
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <SkillList title="Matched skills" skills={report.matched_skills} emptyText="No target skills matched yet." />
                <SkillList title="Missing required skills" skills={report.missing_required_skills} emptyText="No required skill gaps identified." />
                <SkillList title="Missing preferred skills" skills={report.missing_preferred_skills} emptyText="No preferred skill gaps identified." />
                <section>
                  <h3 className="font-semibold text-slate-900 dark:text-white">Weak skills from your latest mock test</h3>
                  {report.weak_skills.length
                    ? <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">{report.weak_skills.map((item) => <li key={item.name}>{item.name} · {item.score}/100</li>)}</ul>
                    : <p className="mt-2 text-sm text-slate-500">No completed mock test skill breakdown is available yet.</p>}
                </section>
              </div>
            </CardContent>
          </Card>

          <section aria-labelledby="skill-learning-title">
            <h2 id="skill-learning-title" className="mb-3 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white"><BookOpen className="h-5 w-5" />Skills to learn</h2>
            {report.learning_suggestions.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {report.learning_suggestions.map((suggestion, index) => (
                  <article key={`${suggestion.skill}-${suggestion.resource.id}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Priority {index + 1} · {suggestion.skill}</p>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{suggestion.message}</p>
                    <a href={suggestion.resource.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 underline dark:text-indigo-300">
                      {suggestion.resource.title} <span aria-hidden="true">↗</span>
                    </a>
                  </article>
                ))}
              </div>
            ) : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900">No verified Learning Library resource matches these skill gaps yet.</p>}
          </section>

          <Card>
            <CardContent className="p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Target className="h-5 w-5" />Resume improvement suggestions</h2>
              <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
                {report.resume_tips.map((tip, index) => <li key={`${index}-${tip}`}>{tip}</li>)}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      <section aria-labelledby="skill-gap-history-title">
        <h2 id="skill-gap-history-title" className="mb-3 flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white"><BarChart3 className="h-5 w-5" />Report history</h2>
        {history.length ? (
          <ul className="space-y-2">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={report?.id === item.id ? 'true' : undefined}
                  onClick={() => setReport(item)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900"
                >
                  <span><span className="block font-semibold text-slate-900 dark:text-white">{item.target_label}</span><span className="mt-1 block text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</span></span>
                  <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{item.estimated_match_score === null ? 'No score' : `Estimated ${item.estimated_match_score}/100`}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900">Your analyses will appear here. Reports are saved as separate runs.</p>}
      </section>
    </main>
  )
}
