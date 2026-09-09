import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import {
  GraduationCap,
  Building,
  ShieldCheck,
  Search,
  ArrowRight,
  CheckCircle2,
  MapPin,
  Sparkles,
} from 'lucide-react'
import { DesktopAnalysisVisuals } from '../components/analytics/DesktopAnalysisVisuals'

export function LandingPage() {
  const navigate = useNavigate()
  const { session } = useAuthStore()
  const [featuredJobs, setFeaturedJobs] = useState<any[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    api
      .get('/internships?page_size=3')
      .then((res) => setFeaturedJobs(res.data.items || []))
      .catch(() => {})
  }, [])

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(`/opportunities${searchQuery ? `?location=${encodeURIComponent(searchQuery)}` : ''}`)
  }

  return (
    <div className="w-full flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Verified Student Recruitment Platform</span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight max-w-4xl leading-[1.1]">
          Launch your career with <span className="text-indigo-600">verified internships</span> at top companies.
        </h1>

        <p className="mt-4 text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
          Direct recruitment pipeline for students, transparent vetting for employers, and seamless scheduling with built-in interview and dispute workflows.
        </p>

        {/* Quick Search Bar */}
        <form
          onSubmit={handleHeroSearch}
          className="mt-8 w-full max-w-xl p-2 bg-white rounded-2xl border border-slate-200 shadow-md flex items-center gap-2"
        >
          <div className="flex items-center gap-2 flex-1 pl-3 text-slate-400">
            <Search className="w-4 h-4 shrink-0" />
            <input
              type="text"
              placeholder="Search by city, remote, or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent"
            />
          </div>
          <Button type="submit" variant="primary" size="md">
            Find Roles
          </Button>
        </form>

        {/* Action Buttons if not logged in */}
        {!session && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs">
            <Link to="/register-student">
              <Button variant="outline" size="sm">
                Register as Student
              </Button>
            </Link>
            <Link to="/register-company">
              <Button variant="ghost" size="sm" className="text-slate-600">
                Post an Internship &rarr;
              </Button>
            </Link>
          </div>
        )}
      </section>

      {/* Role Pillars Section */}
      <section className="w-full bg-slate-100/60 border-y border-slate-200 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-xl mx-auto mb-10">
            <h2 className="text-xl font-bold text-slate-900">Tailored for each participant</h2>
            <p className="text-xs text-slate-500 mt-1">
              Purpose-built tools for student applicants, corporate recruiters, and compliance admins.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Student Card */}
            <Card className="p-6 bg-white border-t-4 border-t-emerald-500 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <GraduationCap className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">For Students</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Filter verified internships by stipend and work mode, apply with one click using your stored resume, and track application progress live.
              </p>
              <ul className="text-xs text-slate-600 space-y-1.5 pt-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  Free resume storage & versioning
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  Direct messaging with hiring managers
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  Real-time interview scheduling
                </li>
              </ul>
              <div className="pt-3">
                <Link to="/register-student">
                  <Button size="sm" variant="outline" className="w-full">
                    Student Signup
                  </Button>
                </Link>
              </div>
            </Card>

            {/* Company Card */}
            <Card className="p-6 bg-white border-t-4 border-t-indigo-600 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Building className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">For Employers</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Post verified internship opportunities, review candidate resumes with authenticated security, and advance candidates through pipeline stages.
              </p>
              <ul className="text-xs text-slate-600 space-y-1.5 pt-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  Structured candidate review pipeline
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  One-click interview calendar invites
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  Organization profile & branding
                </li>
              </ul>
              <div className="pt-3">
                <Link to="/register-company">
                  <Button size="sm" variant="primary" className="w-full">
                    Employer Registration
                  </Button>
                </Link>
              </div>
            </Card>

            {/* Admin Card */}
            <Card className="p-6 bg-white border-t-4 border-t-purple-600 shadow-xs space-y-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Oversight & Compliance</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Centralized moderation console for vetting companies, reviewing job content prior to public discovery, and resolving disputes.
              </p>
              <ul className="text-xs text-slate-600 space-y-1.5 pt-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  Company verification enforcement
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  Spam & scam moderation queue
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                  Audit logging & dispute mediation
                </li>
              </ul>
              <div className="pt-3">
                <Link to="/login">
                  <Button size="sm" variant="outline" className="w-full">
                    Admin Portal
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Featured Opportunities Preview */}
      {featuredJobs.length > 0 && (
        <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Featured Openings</h2>
              <p className="text-xs text-slate-500 mt-0.5">Explore active roles recently approved by moderators.</p>
            </div>
            <Link to="/opportunities" className="text-xs text-indigo-600 font-semibold hover:underline flex items-center gap-1">
              View all roles <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredJobs.map((job) => (
              <Card key={job.id} className="p-5 bg-white space-y-3">
                <div className="flex items-start justify-between">
                  <Badge status={job.work_mode}>{job.work_mode}</Badge>
                  <span className="text-xs font-bold text-slate-900">
                    {job.stipend > 0 ? `$${job.stipend}/mo` : 'Unpaid'}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 line-clamp-1">{job.title}</h4>
                  <p className="text-xs font-semibold text-indigo-600 flex items-center gap-1 mt-0.5">
                    <Building className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span>{job.company_name || 'Enterprise Partner'}</span>
                  </p>
                  <p className="text-xs text-slate-500 line-clamp-2 mt-1">{job.description}</p>
                </div>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {job.location}
                  </span>
                  <Link to="/opportunities" className="text-indigo-600 font-medium hover:underline">
                    Details &rarr;
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Desktop Ecosystem Analysis Visuals Section */}
      <section className="hidden md:block w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <DesktopAnalysisVisuals
          variant="public"
          title="Transparent Ecosystem Analytics & Insights"
          subtitle="Explore live recruitment metrics: placement progression, hiring speed, and role distributions"
        />
      </section>
    </div>
  )
}
