import { useState, useEffect } from 'react'
import {
  X,
  Printer,
  Download,
  Plus,
  Trash2,
  Sparkles,
  CheckCircle2,
  FileText,
  Briefcase,
  GraduationCap,
  Code,
  FolderGit2,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { api } from '../../api/client'

export interface ResumeData {
  fullName: string
  headline: string
  email: string
  phone: string
  location: string
  website: string
  linkedin: string
  github: string
  summary: string
  education: Array<{
    id: string
    school: string
    degree: string
    field: string
    year: string
    gpa?: string
  }>
  experience: Array<{
    id: string
    company: string
    role: string
    location: string
    startDate: string
    endDate: string
    bullets: string[]
  }>
  projects: Array<{
    id: string
    title: string
    technologies: string
    link?: string
    bullets: string[]
  }>
  skills: {
    languages: string
    frameworks: string
    tools: string
  }
  certifications: string[]
}

const defaultResumeData: ResumeData = {
  fullName: '',
  headline: 'Software Engineering Intern | Full-Stack & Cloud Enthusiast',
  email: '',
  phone: '+1 (555) 234-5678',
  location: 'San Francisco, CA',
  website: 'https://portfolio.dev',
  linkedin: 'linkedin.com/in/student',
  github: 'github.com/student',
  summary:
    'Dedicated Computer Science undergraduate with a solid foundation in software development, data structures, and cloud systems. Proven experience building scalable web applications and REST APIs. Seeking a summer engineering internship to contribute to high-impact production features.',
  education: [
    {
      id: 'edu-1',
      school: 'University of Technology',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      year: '2023 – 2027',
      gpa: '3.8 / 4.0',
    },
  ],
  experience: [
    {
      id: 'exp-1',
      company: 'Tech Innovations Lab',
      role: 'Software Development Intern',
      location: 'Remote',
      startDate: 'May 2025',
      endDate: 'Aug 2025',
      bullets: [
        'Developed reusable React and TypeScript micro-components, reducing UI rendering latency by 28%.',
        'Implemented automated CI/CD unit testing pipelines with PyTest and GitHub Actions, cutting deploy regressions by 35%.',
        'Collaborated with senior engineers in bi-weekly agile sprints to architect relational PostgreSQL schemas.',
      ],
    },
  ],
  projects: [
    {
      id: 'proj-1',
      title: 'InternSphere Connection Engine',
      technologies: 'React, TypeScript, FastAPI, PostgreSQL, TailwindCSS',
      link: 'github.com/student/internsphere',
      bullets: [
        'Engineered an ATS-friendly recruitment pipeline tracking applications, interview velocity, and placement metrics.',
        'Designed secure JWT authentication with role-based access control and verification guards.',
      ],
    },
  ],
  skills: {
    languages: 'Python, TypeScript, JavaScript, SQL, C++, Java',
    frameworks: 'React, FastAPI, Node.js, Next.js, Express, TailwindCSS',
    tools: 'Git, Docker, PostgreSQL, Redis, Postman, Linux, AWS S3',
  },
  certifications: [
    'AWS Certified Cloud Practitioner',
    'Meta Front-End Developer Professional Certificate',
  ],
}

interface ResumeEditorModalProps {
  isOpen: boolean
  onClose: () => void
  initialProfile?: {
    full_name?: string
    university?: string
    major?: string
    graduation_year?: number
    skills?: string
    bio?: string
    email?: string
  }
  onSaveToProfile?: () => void
}

export function ResumeEditorModal({
  isOpen,
  onClose,
  initialProfile,
  onSaveToProfile,
}: ResumeEditorModalProps) {
  const [activeTab, setActiveTab] = useState<'contact' | 'summary' | 'education' | 'experience' | 'projects' | 'skills'>('contact')
  const [resumeData, setResumeData] = useState<ResumeData>(() => {
    const saved = localStorage.getItem('internsphere_resume_builder')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {
        // fallback
      }
    }
    return defaultResumeData
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')

  // Auto pre-fill from student profile if default is empty
  useEffect(() => {
    if (initialProfile && (!resumeData.fullName || resumeData.fullName === '')) {
      setResumeData((prev) => ({
        ...prev,
        fullName: initialProfile.full_name || prev.fullName,
        email: initialProfile.email || prev.email,
        summary: initialProfile.bio || prev.summary,
        education: prev.education.map((e, idx) =>
          idx === 0
            ? {
                ...e,
                school: initialProfile.university || e.school,
                field: initialProfile.major || e.field,
                year: initialProfile.graduation_year ? `Expected ${initialProfile.graduation_year}` : e.year,
              }
            : e
        ),
        skills: {
          ...prev.skills,
          languages: initialProfile.skills || prev.skills.languages,
        },
      }))
    }
  }, [initialProfile])

  // Save to localStorage automatically
  useEffect(() => {
    localStorage.setItem('internsphere_resume_builder', JSON.stringify(resumeData))
  }, [resumeData])

  if (!isOpen) return null

  // Helper functions to update fields
  const updateField = (field: keyof ResumeData, value: any) => {
    setResumeData((prev) => ({ ...prev, [field]: value }))
  }

  const addEducation = () => {
    const newEdu = {
      id: `edu-${Date.now()}`,
      school: 'University / College',
      degree: 'Bachelor of Science',
      field: 'Computer Science',
      year: '2024 – 2028',
      gpa: '3.7 / 4.0',
    }
    updateField('education', [...resumeData.education, newEdu])
  }

  const removeEducation = (id: string) => {
    updateField(
      'education',
      resumeData.education.filter((e) => e.id !== id)
    )
  }

  const addExperience = () => {
    const newExp = {
      id: `exp-${Date.now()}`,
      company: 'Company / Project',
      role: 'Software Intern',
      location: 'Remote',
      startDate: 'June 2025',
      endDate: 'Aug 2025',
      bullets: [
        'Built key application components with clean code and high unit test coverage.',
        'Assisted in debugging production services and improving API performance.',
      ],
    }
    updateField('experience', [...resumeData.experience, newExp])
  }

  const removeExperience = (id: string) => {
    updateField(
      'experience',
      resumeData.experience.filter((e) => e.id !== id)
    )
  }

  const addProject = () => {
    const newProj = {
      id: `proj-${Date.now()}`,
      title: 'Personal Project',
      technologies: 'React, Node.js, PostgreSQL',
      link: 'github.com/user/project',
      bullets: [
        'Built a complete end-to-end full-stack web app with user auth and dashboard analytics.',
      ],
    }
    updateField('projects', [...resumeData.projects, newProj])
  }

  const removeProject = (id: string) => {
    updateField(
      'projects',
      resumeData.projects.filter((p) => p.id !== id)
    )
  }

  // Print handler
  const handlePrint = () => {
    window.print()
  }

  // Save to student profile in backend
  const handleSyncToProfile = async () => {
    setIsSaving(true)
    setSaveSuccess(false)
    try {
      // Sync bio and skills to profile
      const combinedSkills = [
        resumeData.skills.languages,
        resumeData.skills.frameworks,
        resumeData.skills.tools,
      ]
        .filter(Boolean)
        .join(', ')

      const firstEdu = resumeData.education[0]

      await api.put('/profiles/student', {
        full_name: resumeData.fullName || initialProfile?.full_name || 'Student Candidate',
        university: firstEdu?.school || initialProfile?.university || 'University',
        major: firstEdu?.field || initialProfile?.major || 'Computer Science',
        graduation_year: initialProfile?.graduation_year || 2026,
        skills: combinedSkills.slice(0, 500),
        bio: resumeData.summary.slice(0, 500),
      })

      setSaveSuccess(true)
      if (onSaveToProfile) onSaveToProfile()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch {
      alert('Could not sync changes to live profile, but changes are stored locally.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200 print:p-0 print:m-0 print:bg-white print:fixed-none">
      {/* Modal Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden print:border-none print:shadow-none print:max-h-none print:h-auto">
        
        {/* Header Ribbon (Hidden during print) */}
        <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  ATS Resume Builder & Editor
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  ATS Compliant 100%
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Edit credentials directly in-app with live formatting, instant PDF export, and profile sync.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile View Toggle */}
            <div className="flex lg:hidden rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setMobileView('edit')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  mobileView === 'edit'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setMobileView('preview')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  mobileView === 'preview'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                ATS Preview
              </button>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              leftIcon={<Printer className="w-3.5 h-3.5" />}
              className="text-xs font-medium"
            >
              Print / Save PDF
            </Button>

            <Button
              size="sm"
              variant="primary"
              onClick={handleSyncToProfile}
              isLoading={isSaving}
              leftIcon={saveSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
              className="text-xs font-medium"
            >
              {saveSuccess ? 'Synced to Profile!' : 'Sync to Profile'}
            </Button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body: Split View (Editor Left, ATS Preview Right) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* Left Column: Form Controls (Hidden on mobile when preview selected) */}
          <div
            className={`lg:col-span-6 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0 ${
              mobileView === 'preview' ? 'hidden lg:flex' : 'flex'
            } print:hidden`}
          >
            {/* Form Section Navigation Tabs */}
            <div className="flex items-center gap-1 p-2 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 overflow-x-auto text-xs shrink-0">
              {[
                { id: 'contact', label: 'Contact', icon: <Briefcase className="w-3 h-3" /> },
                { id: 'summary', label: 'Summary', icon: <Sparkles className="w-3 h-3" /> },
                { id: 'education', label: 'Education', icon: <GraduationCap className="w-3 h-3" /> },
                { id: 'experience', label: 'Experience', icon: <Briefcase className="w-3 h-3" /> },
                { id: 'projects', label: 'Projects', icon: <FolderGit2 className="w-3 h-3" /> },
                { id: 'skills', label: 'Skills', icon: <Code className="w-3 h-3" /> },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as any)}
                  className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                    activeTab === t.id
                      ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* Form Fields Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* CONTACT TAB */}
              {activeTab === 'contact' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Candidate Contact & Links
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={resumeData.fullName}
                        onChange={(e) => updateField('fullName', e.target.value)}
                        placeholder="e.g. Alex Morgan"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Target Headline / Role
                      </label>
                      <input
                        type="text"
                        value={resumeData.headline}
                        onChange={(e) => updateField('headline', e.target.value)}
                        placeholder="e.g. Software Engineer Intern"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={resumeData.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        placeholder="alex@example.com"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={resumeData.phone}
                        onChange={(e) => updateField('phone', e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Location / City, Country
                      </label>
                      <input
                        type="text"
                        value={resumeData.location}
                        onChange={(e) => updateField('location', e.target.value)}
                        placeholder="San Francisco, CA"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Portfolio / Website
                      </label>
                      <input
                        type="text"
                        value={resumeData.website}
                        onChange={(e) => updateField('website', e.target.value)}
                        placeholder="https://yourportfolio.com"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        LinkedIn Profile
                      </label>
                      <input
                        type="text"
                        value={resumeData.linkedin}
                        onChange={(e) => updateField('linkedin', e.target.value)}
                        placeholder="linkedin.com/in/username"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        GitHub Profile
                      </label>
                      <input
                        type="text"
                        value={resumeData.github}
                        onChange={(e) => updateField('github', e.target.value)}
                        placeholder="github.com/username"
                        className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SUMMARY TAB */}
              {activeTab === 'summary' && (
                <div className="space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Executive Summary / Objective
                    </h4>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'summary',
                          'Ambitious Computer Science candidate with proven hands-on experience developing REST APIs, reactive client applications, and microservice architectures. Demonstrates strong problem-solving skills, algorithmic agility, and cross-functional team collaboration.'
                        )
                      }
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" /> Load ATS Sample
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={resumeData.summary}
                    onChange={(e) => updateField('summary', e.target.value)}
                    placeholder="Write a concise 3-4 sentence professional summary highlighting your key achievements, technical specialties, and career objectives..."
                    className="w-full text-xs p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
                  />
                </div>
              )}

              {/* EDUCATION TAB */}
              {activeTab === 'education' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Education Credentials
                    </h4>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addEducation}
                      leftIcon={<Plus className="w-3 h-3" />}
                      className="text-xs"
                    >
                      Add Degree
                    </Button>
                  </div>

                  {resumeData.education.map((edu, idx) => (
                    <div
                      key={edu.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5 relative"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          Institution #{idx + 1}
                        </span>
                        {resumeData.education.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeEducation(edu.id)}
                            className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                            title="Remove Education"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          value={edu.school}
                          placeholder="Institution Name"
                          onChange={(e) => {
                            const updated = resumeData.education.map((item) =>
                              item.id === edu.id ? { ...item, school: e.target.value } : item
                            )
                            updateField('education', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={edu.degree}
                          placeholder="Degree (e.g. B.S., M.S.)"
                          onChange={(e) => {
                            const updated = resumeData.education.map((item) =>
                              item.id === edu.id ? { ...item, degree: e.target.value } : item
                            )
                            updateField('education', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={edu.field}
                          placeholder="Major / Field of Study"
                          onChange={(e) => {
                            const updated = resumeData.education.map((item) =>
                              item.id === edu.id ? { ...item, field: e.target.value } : item
                            )
                            updateField('education', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={edu.year}
                            placeholder="Years (e.g. 2023 – 2027)"
                            onChange={(e) => {
                              const updated = resumeData.education.map((item) =>
                                item.id === edu.id ? { ...item, year: e.target.value } : item
                              )
                              updateField('education', updated)
                            }}
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <input
                            type="text"
                            value={edu.gpa || ''}
                            placeholder="GPA (optional)"
                            onChange={(e) => {
                              const updated = resumeData.education.map((item) =>
                                item.id === edu.id ? { ...item, gpa: e.target.value } : item
                              )
                              updateField('education', updated)
                            }}
                            className="w-24 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* EXPERIENCE TAB */}
              {activeTab === 'experience' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Work & Internship Experience
                    </h4>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addExperience}
                      leftIcon={<Plus className="w-3 h-3" />}
                      className="text-xs"
                    >
                      Add Position
                    </Button>
                  </div>

                  {resumeData.experience.map((exp, idx) => (
                    <div
                      key={exp.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          Role #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeExperience(exp.id)}
                          className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                          title="Remove Experience"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          value={exp.company}
                          placeholder="Company / Employer"
                          onChange={(e) => {
                            const updated = resumeData.experience.map((item) =>
                              item.id === exp.id ? { ...item, company: e.target.value } : item
                            )
                            updateField('experience', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={exp.role}
                          placeholder="Job Title"
                          onChange={(e) => {
                            const updated = resumeData.experience.map((item) =>
                              item.id === exp.id ? { ...item, role: e.target.value } : item
                            )
                            updateField('experience', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={exp.location}
                          placeholder="Location / Remote"
                          onChange={(e) => {
                            const updated = resumeData.experience.map((item) =>
                              item.id === exp.id ? { ...item, location: e.target.value } : item
                            )
                            updateField('experience', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={exp.startDate}
                            placeholder="Start Date"
                            onChange={(e) => {
                              const updated = resumeData.experience.map((item) =>
                                item.id === exp.id ? { ...item, startDate: e.target.value } : item
                              )
                              updateField('experience', updated)
                            }}
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <input
                            type="text"
                            value={exp.endDate}
                            placeholder="End Date"
                            onChange={(e) => {
                              const updated = resumeData.experience.map((item) =>
                                item.id === exp.id ? { ...item, endDate: e.target.value } : item
                              )
                              updateField('experience', updated)
                            }}
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Bullet Points (One bullet per line)
                        </label>
                        <textarea
                          rows={3}
                          value={exp.bullets.join('\n')}
                          onChange={(e) => {
                            const updated = resumeData.experience.map((item) =>
                              item.id === exp.id
                                ? { ...item, bullets: e.target.value.split('\n').filter(Boolean) }
                                : item
                            )
                            updateField('experience', updated)
                          }}
                          placeholder="Accomplished X as measured by Y, by doing Z..."
                          className="w-full text-xs p-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PROJECTS TAB */}
              {activeTab === 'projects' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Technical Projects
                    </h4>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addProject}
                      leftIcon={<Plus className="w-3 h-3" />}
                      className="text-xs"
                    >
                      Add Project
                    </Button>
                  </div>

                  {resumeData.projects.map((proj, idx) => (
                    <div
                      key={proj.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          Project #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeProject(proj.id)}
                          className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                          title="Remove Project"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          value={proj.title}
                          placeholder="Project Title"
                          onChange={(e) => {
                            const updated = resumeData.projects.map((item) =>
                              item.id === proj.id ? { ...item, title: e.target.value } : item
                            )
                            updateField('projects', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <input
                          type="text"
                          value={proj.technologies}
                          placeholder="Technologies Used"
                          onChange={(e) => {
                            const updated = resumeData.projects.map((item) =>
                              item.id === proj.id ? { ...item, technologies: e.target.value } : item
                            )
                            updateField('projects', updated)
                          }}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                      </div>

                      <input
                        type="text"
                        value={proj.link || ''}
                        placeholder="Project Link (GitHub or Live Demo URL)"
                        onChange={(e) => {
                          const updated = resumeData.projects.map((item) =>
                            item.id === proj.id ? { ...item, link: e.target.value } : item
                          )
                          updateField('projects', updated)
                        }}
                        className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Bullet Points (One bullet per line)
                        </label>
                        <textarea
                          rows={2}
                          value={proj.bullets.join('\n')}
                          onChange={(e) => {
                            const updated = resumeData.projects.map((item) =>
                              item.id === proj.id
                                ? { ...item, bullets: e.target.value.split('\n').filter(Boolean) }
                                : item
                            )
                            updateField('projects', updated)
                          }}
                          placeholder="Describe technical impact, key features, performance metrics..."
                          className="w-full text-xs p-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* SKILLS & CERTS TAB */}
              {activeTab === 'skills' && (
                <div className="space-y-3.5 animate-in fade-in duration-150">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Categorized Competencies
                  </h4>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Languages & Syntax
                    </label>
                    <input
                      type="text"
                      value={resumeData.skills.languages}
                      onChange={(e) =>
                        updateField('skills', { ...resumeData.skills, languages: e.target.value })
                      }
                      placeholder="Python, TypeScript, JavaScript, SQL, C++"
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Frameworks & Architectures
                    </label>
                    <input
                      type="text"
                      value={resumeData.skills.frameworks}
                      onChange={(e) =>
                        updateField('skills', { ...resumeData.skills, frameworks: e.target.value })
                      }
                      placeholder="React, FastAPI, Node.js, Next.js, TailwindCSS"
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Tools, Cloud & DevOps
                    </label>
                    <input
                      type="text"
                      value={resumeData.skills.tools}
                      onChange={(e) =>
                        updateField('skills', { ...resumeData.skills, tools: e.target.value })
                      }
                      placeholder="Git, Docker, PostgreSQL, Redis, Linux, AWS"
                      className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div className="pt-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Certifications (One per line)
                    </label>
                    <textarea
                      rows={3}
                      value={resumeData.certifications.join('\n')}
                      onChange={(e) =>
                        updateField(
                          'certifications',
                          e.target.value.split('\n').filter(Boolean)
                        )
                      }
                      placeholder="AWS Certified Cloud Practitioner&#10;Meta Front-End Developer"
                      className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live ATS-Standard Paper Preview */}
          <div
            className={`lg:col-span-6 bg-slate-200 dark:bg-slate-950 p-3 sm:p-6 overflow-y-auto flex justify-center ${
              mobileView === 'edit' ? 'hidden lg:flex' : 'flex'
            } print:p-0 print:m-0 print:bg-white print:block print:w-full`}
          >
            {/* Standard Letter Paper Simulation */}
            <div
              id="resume-printable-area"
              className="w-full max-w-[700px] bg-white text-slate-900 rounded-lg shadow-xl border border-slate-300/80 p-8 sm:p-10 font-sans space-y-4 print:shadow-none print:border-none print:p-0 print:m-0 print:max-w-none print:rounded-none"
              style={{ minHeight: '880px', color: '#111827' }}
            >
              {/* Header: Candidate Name & Target Headline */}
              <div className="text-center border-b border-slate-300 pb-3.5 space-y-1">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-serif uppercase">
                  {resumeData.fullName || 'Candidate Name'}
                </h1>
                {resumeData.headline && (
                  <p className="text-xs font-semibold text-indigo-700 tracking-wide">
                    {resumeData.headline}
                  </p>
                )}
                {/* Contact Ribbon */}
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-slate-600 pt-1">
                  {resumeData.email && <span>{resumeData.email}</span>}
                  {resumeData.email && resumeData.phone && <span>•</span>}
                  {resumeData.phone && <span>{resumeData.phone}</span>}
                  {resumeData.phone && resumeData.location && <span>•</span>}
                  {resumeData.location && <span>{resumeData.location}</span>}
                  {resumeData.linkedin && (
                    <>
                      <span>•</span>
                      <span>{resumeData.linkedin}</span>
                    </>
                  )}
                  {resumeData.github && (
                    <>
                      <span>•</span>
                      <span>{resumeData.github}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Summary Section */}
              {resumeData.summary && (
                <div className="space-y-1">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Professional Summary
                  </h2>
                  <p className="text-[11.5px] leading-relaxed text-slate-700 text-justify">
                    {resumeData.summary}
                  </p>
                </div>
              )}

              {/* Education Section */}
              {resumeData.education.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Education
                  </h2>
                  {resumeData.education.map((edu) => (
                    <div key={edu.id} className="text-[11.5px]">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>{edu.school}</span>
                        <span className="font-normal text-slate-600">{edu.year}</span>
                      </div>
                      <div className="flex justify-between text-slate-700 italic">
                        <span>
                          {edu.degree} in {edu.field}
                        </span>
                        {edu.gpa && <span className="font-normal not-italic">GPA: {edu.gpa}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Work Experience Section */}
              {resumeData.experience.length > 0 && (
                <div className="space-y-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Experience & Internships
                  </h2>
                  {resumeData.experience.map((exp) => (
                    <div key={exp.id} className="space-y-1 text-[11.5px]">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>
                          {exp.role} <span className="font-normal text-slate-600">— {exp.company}</span>
                        </span>
                        <span className="font-normal text-slate-600">
                          {exp.startDate} – {exp.endDate}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 italic">{exp.location}</p>
                      {exp.bullets.length > 0 && (
                        <ul className="list-disc list-outside ml-4 space-y-0.5 text-slate-700 text-[11px] leading-relaxed">
                          {exp.bullets.map((bullet, bIdx) => (
                            <li key={bIdx}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Projects Section */}
              {resumeData.projects.length > 0 && (
                <div className="space-y-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Technical Projects
                  </h2>
                  {resumeData.projects.map((proj) => (
                    <div key={proj.id} className="space-y-1 text-[11.5px]">
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>
                          {proj.title}{' '}
                          {proj.technologies && (
                            <span className="font-normal text-slate-500">| {proj.technologies}</span>
                          )}
                        </span>
                        {proj.link && (
                          <span className="font-mono text-[10.5px] text-indigo-600 font-normal">
                            {proj.link}
                          </span>
                        )}
                      </div>
                      {proj.bullets.length > 0 && (
                        <ul className="list-disc list-outside ml-4 space-y-0.5 text-slate-700 text-[11px] leading-relaxed">
                          {proj.bullets.map((bullet, bIdx) => (
                            <li key={bIdx}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Technical Skills Section */}
              {(resumeData.skills.languages ||
                resumeData.skills.frameworks ||
                resumeData.skills.tools) && (
                <div className="space-y-1 text-[11.5px]">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Skills & Competencies
                  </h2>
                  <div className="space-y-1 text-[11px] pt-0.5">
                    {resumeData.skills.languages && (
                      <p>
                        <strong className="text-slate-900">Languages:</strong>{' '}
                        <span className="text-slate-700">{resumeData.skills.languages}</span>
                      </p>
                    )}
                    {resumeData.skills.frameworks && (
                      <p>
                        <strong className="text-slate-900">Frameworks:</strong>{' '}
                        <span className="text-slate-700">{resumeData.skills.frameworks}</span>
                      </p>
                    )}
                    {resumeData.skills.tools && (
                      <p>
                        <strong className="text-slate-900">Developer Tools:</strong>{' '}
                        <span className="text-slate-700">{resumeData.skills.tools}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Certifications Section */}
              {resumeData.certifications.length > 0 && (
                <div className="space-y-1 text-[11.5px]">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-200 pb-0.5 font-serif">
                    Certifications & Honors
                  </h2>
                  <ul className="list-disc list-outside ml-4 space-y-0.5 text-slate-700 text-[11px]">
                    {resumeData.certifications.map((cert, cIdx) => (
                      <li key={cIdx}>{cert}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer info ribbon */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0 print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Edits persist automatically in your browser session.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              leftIcon={<Download className="w-3.5 h-3.5" />}
              className="text-xs"
            >
              Export as PDF
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={onClose}
              className="text-xs"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
