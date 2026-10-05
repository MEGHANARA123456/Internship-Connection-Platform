import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'

export function FinalCta() {
  return (
    <section className="w-full bg-slate-950 text-white py-24 border-t border-slate-900 relative overflow-hidden">
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
        <div className="w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px]"></div>
      </div>
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10 space-y-8">
        <h2 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1]">
          What's your <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400 italic">next move?</span>
        </h2>
        
        <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
          <Link to="/register-student">
            <Button variant="primary" size="md" className="rounded-3xl px-8 bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-lg shadow-indigo-900/50">
              Sign up to find an internship &rarr;
            </Button>
          </Link>
          <Link to="/register-company">
            <Button variant="outline" size="md" className="rounded-3xl px-8 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              Start hiring
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
