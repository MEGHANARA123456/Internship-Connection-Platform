import { Link } from 'react-router-dom'
import { ShieldCheck, Lock, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

export function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full space-y-8 animate-in fade-in duration-200">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </Link>

        <Link to="/privacy-center">
          <Button variant="outline" size="sm" className="text-xs">
            <Lock className="w-3.5 h-3.5 mr-1 text-indigo-500" />
            Manage My Privacy & Security
          </Button>
        </Link>
      </div>

      {/* Header Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/40 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>General Data Protection Regulation (GDPR) & CCPA/CPRA Compliant</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Privacy Policy & Data Protection Statement
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          Last Updated & Ratified: September 2026 • Effective Worldwide
        </p>
      </div>

      {/* Main Content Body */}
      <Card className="p-6 sm:p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-8 text-slate-700 dark:text-slate-300 leading-relaxed text-sm">
        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              1
            </span>
            <span>Data Controller & Scope</span>
          </h2>
          <p>
            InternSphere Inc. (&ldquo;InternSphere&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;) operates the verified student recruitment and internship connection ecosystem. Under the EU General Data Protection Regulation (Regulation (EU) 2016/679, &ldquo;GDPR&rdquo;) and California Consumer Privacy Act (&ldquo;CCPA/CPRA&rdquo;), InternSphere acts as the <strong>Data Controller</strong> for personal data submitted directly through our services.
          </p>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
            <p className="font-semibold text-slate-900 dark:text-white">Designated Data Protection Officer (DPO):</p>
            <p>Email: <a href="mailto:privacy@internsphere.com" className="text-indigo-600 dark:text-indigo-400 underline">privacy@internsphere.com</a></p>
            <p>Office: InternSphere Legal & Governance, Global Campus Quad, Suite 100</p>
          </div>
        </section>

        {/* Section 2 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              2
            </span>
            <span>Categories of Personal Data We Process</span>
          </h2>
          <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm">
            <li><strong>Identity & Credentials:</strong> Name, verified email address, institutional affiliation, and Argon2id hashed passwords.</li>
            <li><strong>Student Professional Profiles:</strong> Educational degree, graduation timeline, verified skills, and resume documents.</li>
            <li><strong>Corporate Recruiter Information:</strong> Registered company entity name, domain-verified email, and hiring authority status.</li>
            <li><strong>Application & Communication Artifacts:</strong> Application cover letters, scheduled interview links, and direct messaging exchange history.</li>
            <li><strong>Technical Telemetry:</strong> Anonymized request timestamps, cryptographic session tokens, and security audit records.</li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              3
            </span>
            <span>Legal Bases for Processing (GDPR Article 6)</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-900 dark:text-white block mb-1">Contractual Necessity (Art. 6(1)(b))</span>
              <p className="text-slate-500 dark:text-slate-400">Processing credentials, applications, and scheduling to provide agreed recruitment matching services.</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-900 dark:text-white block mb-1">Consent (Art. 6(1)(a))</span>
              <p className="text-slate-500 dark:text-slate-400">Freely given, granular opt-in consent for telemetry, analytics, and marketing communications.</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-900 dark:text-white block mb-1">Legitimate Interest (Art. 6(1)(f))</span>
              <p className="text-slate-500 dark:text-slate-400">Security audit logging, abuse prevention, rate-limiting, and unauthorized access mitigation.</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-900 dark:text-white block mb-1">Legal Obligation (Art. 6(1)(c))</span>
              <p className="text-slate-500 dark:text-slate-400">Compliance with statutory financial, dispute record-keeping, and law enforcement requests.</p>
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              4
            </span>
            <span>Your Rights (GDPR & CCPA Portability & Erasure)</span>
          </h2>
          <p>
            Under global privacy standards, you hold enforceable rights over your personal data:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs sm:text-sm">
            <li><strong>Right to Access & Portability (GDPR Art. 15/20 & CCPA):</strong> You may download your entire profile, applications, and message archive in structured JSON format instantly via the <Link to="/privacy-center" className="text-indigo-600 dark:text-indigo-400 font-semibold underline">Privacy Center</Link>.</li>
            <li><strong>Right to Erasure / &ldquo;Right to be Forgotten&rdquo; (GDPR Art. 17 & CCPA):</strong> You can permanently delete your account and personal records at any time.</li>
            <li><strong>Right to Rectification (GDPR Art. 16):</strong> Modify your personal profile and skills at any time.</li>
            <li><strong>Right to Restrict or Object (GDPR Art. 18/21):</strong> Withdraw marketing or analytics consent with one click.</li>
            <li><strong>CCPA Do Not Sell/Share (Cal. Civ. Code § 1798.120):</strong> We never sell personal data. You may enforce strict non-sharing anytime.</li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              5
            </span>
            <span>Security & Cryptographic Architecture</span>
          </h2>
          <p>
            We implement state-of-the-art technical and organizational measures (TOMs) under GDPR Article 32:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-indigo-600 dark:text-indigo-400 block mb-1">Argon2id Hashing</span>
              <p className="text-slate-500">Memory-hard password hashing defending against GPU brute-force attacks.</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-indigo-600 dark:text-indigo-400 block mb-1">AES-256 Symmetric</span>
              <p className="text-slate-500">Fernet authenticated symmetric encryption protects sensitive PII at rest.</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <span className="font-bold text-indigo-600 dark:text-indigo-400 block mb-1">HSTS & TLS 1.3</span>
              <p className="text-slate-500">Enforced HTTPS with strict content security policies and frame isolation.</p>
            </div>
          </div>
        </section>

        {/* Section 6 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
              6
            </span>
            <span>Data Retention & Erasure Schedule</span>
          </h2>
          <p>
            Personal data is retained only as long as necessary to fulfill recruitment services:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li><strong>Active accounts:</strong> Kept current during enrollment or corporate hiring cycles.</li>
            <li><strong>Inactive accounts:</strong> Anonymized after 24 continuous months of inactivity.</li>
            <li><strong>Erased accounts:</strong> Uploaded resumes and identifying details are deleted immediately upon user erasure request.</li>
          </ul>
        </section>
      </Card>
    </div>
  )
}
