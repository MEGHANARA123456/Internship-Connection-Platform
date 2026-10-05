import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'

export function CompaniesSection() {
  return (
    <section className="w-full bg-slate-950 dark:bg-slate-950 text-slate-50 py-20 border-t border-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <span className="inline-block text-indigo-500 font-mono text-xs font-bold uppercase tracking-wider">
              For Companies
            </span>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] text-white">
              Build the team that <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400 italic">defines what's next.</span>
            </h2>
            <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-lg">
              Post verified internship opportunities, access a structured candidate pipeline, and schedule interviews with one click.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link to="/register-company">
                <Button variant="primary" size="md" className="rounded-3xl px-6 bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-lg shadow-indigo-900/20">
                  Post an internship &rarr;
                </Button>
              </Link>
              <Button variant="outline" size="md" className="rounded-3xl px-6 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                See how it works
              </Button>
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl flex gap-4 items-start transition-all hover:bg-slate-800/80">
              <span className="text-indigo-500 font-mono font-bold text-lg mt-0.5">01</span>
              <div>
                <h4 className="text-white font-bold mb-1">Verified listings after moderation</h4>
                <p className="text-slate-400 text-sm">Every company is vetted to maintain a high-quality ecosystem for students.</p>
              </div>
            </div>
            <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl flex gap-4 items-start transition-all hover:bg-slate-800/80">
              <span className="text-indigo-500 font-mono font-bold text-lg mt-0.5">02</span>
              <div>
                <h4 className="text-white font-bold mb-1">Structured candidate pipeline</h4>
                <p className="text-slate-400 text-sm">Easily track applicants through multiple stages of your recruitment process.</p>
              </div>
            </div>
            <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 shadow-xl flex gap-4 items-start transition-all hover:bg-slate-800/80">
              <span className="text-indigo-500 font-mono font-bold text-lg mt-0.5">03</span>
              <div>
                <h4 className="text-white font-bold mb-1">One-click interview scheduling</h4>
                <p className="text-slate-400 text-sm">Seamlessly coordinate with candidates without leaving the platform.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
