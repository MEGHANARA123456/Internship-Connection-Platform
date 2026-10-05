import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Search, Building } from 'lucide-react'
import { Badge } from '../ui/Badge'

export function StudentsSection() {
  return (
    <section className="w-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 py-20 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6 order-2 lg:order-1">
            <span className="inline-block text-indigo-600 dark:text-indigo-400 font-mono text-xs font-bold uppercase tracking-wider">
              For Students
            </span>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
              Find work <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-500 dark:from-indigo-400 dark:to-violet-400 italic">that matters.</span>
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm md:text-base leading-relaxed max-w-lg">
              Discover verified internships tailored to your skills. Apply with a single click, track your applications in real-time, and get hired faster.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link to="/register-student">
                <Button variant="primary" size="md" className="rounded-3xl px-6 bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-lg shadow-indigo-600/20">
                  Sign up for free &rarr;
                </Button>
              </Link>
              <Button variant="outline" size="md" className="rounded-3xl px-6 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                Learn more
              </Button>
            </div>
            
            <div className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h4 className="font-bold flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono text-sm">01</span>
                  Create your profile
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Build a comprehensive portfolio highlighting your skills and education.</p>
              </div>
              <div>
                <h4 className="font-bold flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono text-sm">02</span>
                  Discover matches
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Get personalized recommendations based on your preferences.</p>
              </div>
              <div>
                <h4 className="font-bold flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono text-sm">03</span>
                  Apply in one click
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Use your stored resume to apply to multiple roles instantly.</p>
              </div>
              <div>
                <h4 className="font-bold flex items-center gap-2 mb-1">
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono text-sm">04</span>
                  Track progress
                </h4>
                <p className="text-slate-500 dark:text-slate-400 text-xs">Monitor your applications from review to final interview.</p>
              </div>
            </div>
          </div>
          
          <div className="order-1 lg:order-2">
            <div className="bg-white dark:bg-slate-950 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl max-w-md mx-auto transform rotate-1 hover:rotate-0 transition-transform duration-300">
              <div className="flex items-center gap-3 mb-6 p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
                <Search className="w-4 h-4 text-slate-400" />
                <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
                <div className="w-16 h-6 bg-indigo-100 dark:bg-indigo-900/50 rounded-full"></div>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 border border-slate-100 dark:border-slate-800 rounded-2xl flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex gap-2 items-center">
                       <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">NEW</span>
                       <Badge status="REMOTE">Remote</Badge>
                    </div>
                    <span className="text-sm font-bold">$1200/mo</span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm">Frontend Developer Intern</h5>
                    <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400">
                      <Building className="w-3 h-3" /> TechCorp Inc.
                    </div>
                  </div>
                </div>
                
                <div className="p-4 border border-slate-100 dark:border-slate-800 rounded-2xl flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex gap-2 items-center">
                       <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">NEW</span>
                       <Badge status="HYBRID">Hybrid</Badge>
                    </div>
                    <span className="text-sm font-bold">$800/mo</span>
                  </div>
                  <div>
                    <h5 className="font-bold text-sm">Marketing Coordinator</h5>
                    <div className="flex items-center gap-1 mt-1 text-xs text-indigo-600 dark:text-indigo-400">
                      <Building className="w-3 h-3" /> GlobalMedia
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
