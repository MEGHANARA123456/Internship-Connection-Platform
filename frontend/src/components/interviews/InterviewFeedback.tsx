import { CheckCircle2, Lightbulb } from 'lucide-react'
import type { InterviewEvaluation } from '../../types/interview'

const rubricRows = [
  ['relevance', 'Relevance'],
  ['technical_correctness', 'Technical correctness'],
  ['completeness', 'Completeness'],
  ['communication', 'Communication'],
  ['structure', 'Structure'],
] as const

export function InterviewFeedback({ evaluation }: { evaluation: InterviewEvaluation }) {
  return (
    <section aria-label="Interview feedback" className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <div>
        <h2 className="font-semibold text-indigo-950 dark:text-indigo-100">Feedback</h2>
        <p className="mt-1 text-sm leading-6 text-slate-700 dark:text-slate-300">{evaluation.feedback}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rubricRows.map(([key, label]) => (
          <div key={key} className="rounded-lg bg-white/80 p-3 dark:bg-slate-900/80">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {evaluation[key]}/10
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        <FeedbackList title="Strengths" items={evaluation.strengths} icon="strength" />
        <FeedbackList title="Suggestions" items={evaluation.improvements} icon="improvement" />
      </div>
    </section>
  )
}

function FeedbackList({
  title,
  items,
  icon,
}: {
  title: string
  items: string[]
  icon: 'strength' | 'improvement'
}) {
  const Icon = icon === 'strength' ? CheckCircle2 : Lightbulb
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
        {title}
      </h3>
      {items.length > 0
        ? <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No items provided.</p>}
    </div>
  )
}
