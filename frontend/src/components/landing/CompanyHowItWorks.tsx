const hiringSteps = [
  'Register your company',
  'Get verified',
  'Post an internship',
  'Review and hire',
]

export function CompanyHowItWorks() {
  return (
    <section
      id="company-how-it-works"
      className="w-full scroll-mt-24 border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          How hiring works
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {hiringSteps.map((step, index) => (
            <li
              key={step}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-950"
            >
              <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
