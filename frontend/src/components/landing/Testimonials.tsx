export function Testimonials() {
  return (
    <section className="w-full bg-white dark:bg-slate-950 py-20 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
            Trusted by those <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-500 dark:from-indigo-400 dark:to-violet-400 italic">who do the work.</span>
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-bold tracking-wider">
              Sample feedback
            </span>
            <p className="text-slate-700 dark:text-slate-300 italic text-lg leading-relaxed">
              "The structured application process made finding my summer internship incredibly straightforward. Knowing all companies were verified gave me peace of mind."
            </p>
          </div>
          
          <div className="p-8 rounded-3xl bg-slate-950 dark:bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
            <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold tracking-wider">
              Sample feedback
            </span>
            <p className="text-slate-300 italic text-lg leading-relaxed">
              "We've cut our hiring time in half. The built-in scheduling and verified student profiles allow us to focus entirely on interviewing the right candidates."
            </p>
          </div>
          
          <div className="p-8 rounded-3xl bg-slate-950 dark:bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
            <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold tracking-wider">
              Sample feedback
            </span>
            <p className="text-slate-300 italic text-lg leading-relaxed">
              "The quality of the applicant pool is consistently high. Having a single platform for tracking, messaging, and scheduling is a game-changer for our small team."
            </p>
          </div>
          
          <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 shadow-sm">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-bold tracking-wider">
              Sample feedback
            </span>
            <p className="text-slate-700 dark:text-slate-300 italic text-lg leading-relaxed">
              "I applied to three roles and heard back from two within a week. The real-time tracking feature removed all the anxiety of the waiting game."
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
