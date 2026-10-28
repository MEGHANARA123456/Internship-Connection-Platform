import { Link } from 'react-router-dom'
import { isKnownInternalRoute } from './safeRoutes'
import type { PersonalSummary } from './types'

export function PersonalSummaryCard({ summary }: { summary: PersonalSummary }) {
  return (
    <section aria-label={summary.title} className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 text-slate-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-slate-100">
      <h3 className="text-xs font-bold">{summary.title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2">
        {summary.items.map((item) => (
          <div key={item.label} className="rounded-lg bg-white/80 p-2 dark:bg-slate-900/70">
            <dt className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</dt>
            <dd className="text-sm font-bold tabular-nums">{item.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      {isKnownInternalRoute(summary.link.route) && (
        <Link to={summary.link.route} className="mt-3 inline-flex text-xs font-semibold text-indigo-700 underline dark:text-indigo-300">
          {summary.link.label} →
        </Link>
      )}
      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">Shown in this chat only; not sent to the help assistant or saved.</p>
    </section>
  )
}
