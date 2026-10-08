import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="w-full bg-slate-950 text-slate-400 py-16 border-t border-slate-900 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-lg tracking-tight">InternSphere</span>
            </div>
            <p className="text-sm">Production Grade Verified Recruitment</p>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-white font-bold text-sm tracking-wide">For Students</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/opportunities" className="hover:text-indigo-400 transition-colors">Browse internships</Link></li>
              <li><Link to="/register-student" className="hover:text-indigo-400 transition-colors">Register</Link></li>
              <li><Link to="/login" className="hover:text-indigo-400 transition-colors">Login</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-white font-bold text-sm tracking-wide">For Companies</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/register-company" className="hover:text-indigo-400 transition-colors">Post an internship</Link></li>
              <li><Link to="/login" className="hover:text-indigo-400 transition-colors">Login</Link></li>
            </ul>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-white font-bold text-sm tracking-wide">Platform</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/privacy" className="hover:text-indigo-400 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/privacy-center" className="hover:text-indigo-400 transition-colors">Privacy Center</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 border-t border-slate-900 flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
          <p>&copy; 2026 InternSphere. All rights reserved.</p>
          <div className="flex items-center gap-4">
             <span className="text-emerald-500 font-medium">Privacy-first by design</span>
             <button type="button" onClick={() => window.dispatchEvent(new Event('open:cookie-preferences'))} className="hover:text-indigo-400 transition-colors cursor-pointer">
                Cookie Preferences
             </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
