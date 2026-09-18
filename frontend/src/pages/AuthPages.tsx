import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import { Button } from '../components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/Card'
import { CheckCircle2, AlertCircle, ShieldCheck, KeyRound } from 'lucide-react'
import { GoogleSignInButton } from '../components/auth/GoogleSignInButton'
import { Logo } from '../components/layout/Logo'

// --- Validation Schemas ---

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const studentRegisterSchema = z.object({
  email: z.string().email('Please enter a valid academic or personal email'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  full_name: z.string().min(2, 'Full name is required'),
  university: z.string().min(2, 'University or college name is required'),
  major: z.string().min(2, 'Major/Field of study is required'),
  graduation_year: z.coerce.number().min(2020, 'Year must be 2020 or later').max(2100),
  skills: z.string().optional().or(z.literal('')),
  bio: z.string().optional().or(z.literal('')),
})

const companyRegisterSchema = z.object({
  email: z.string().email('Please enter a valid corporate email'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  company_name: z.string().min(2, 'Company name is required'),
  industry: z.string().min(2, 'Industry is required (e.g. Technology, Finance)'),
  website: z.string().url('Please enter a valid URL (e.g. https://company.com)').optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
})

const adminRegisterSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  signup_key: z.string().min(16, 'Bootstrap key must be at least 16 characters'),
})

// --- Auth Layout Wrapper ---

function AuthCardLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-slate-50 dark:bg-slate-950 transition-colors">
      <div className="w-full max-w-md">
        <Card className="shadow-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <CardHeader className="text-center pb-4">
            <div className="flex justify-center mb-3">
              <Logo size="lg" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-900 dark:text-white">{title}</CardTitle>
            <CardDescription className="text-xs text-slate-500 dark:text-slate-400">{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
          {footer && <CardFooter className="justify-center text-xs text-slate-500 dark:text-slate-400">{footer}</CardFooter>}
        </Card>
      </div>
    </div>
  )
}

// --- 1. Login Page ---

export function LoginPage() {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)
  const [portal, setPortal] = useState<'STUDENT' | 'COMPANY' | 'ADMIN'>('STUDENT')
  const [serverError, setServerError] = useState('')
  const [resendingVerification, setResendingVerification] = useState(false)
  const [resendStatus, setResendStatus] = useState('')

  // Two-Factor Authentication (MFA) challenge state
  const [mfaChallenge, setMfaChallenge] = useState<{ ticket: string; email: string } | null>(null)
  const [mfaOtp, setMfaOtp] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaError, setMfaError] = useState('')
  const [resendMfaLoading, setResendMfaLoading] = useState(false)
  const [resendMfaStatus, setResendMfaStatus] = useState('')

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  })

  const handleResendVerification = async () => {
    const email = getValues('email')?.trim()
    if (!email || !email.includes('@')) {
      setServerError('Please enter a valid email address first.')
      return
    }
    setResendingVerification(true)
    setResendStatus('')
    try {
      const res = await api.post('/auth/resend-verification', { email })
      setResendStatus(res.data?.message || 'Verification link has been dispatched to your email.')
      setTimeout(() => setResendStatus(''), 6000)
    } catch (err: any) {
      setServerError(err.response?.data?.detail || 'Failed to resend verification link.')
    } finally {
      setResendingVerification(false)
    }
  }

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaChallenge) return
    if (!mfaOtp || mfaOtp.trim().length !== 6) {
      setMfaError('Please enter the complete 6-digit security code.')
      return
    }
    setMfaLoading(true)
    setMfaError('')
    try {
      const res = await api.post('/auth/mfa/verify-login', {
        mfa_ticket: mfaChallenge.ticket,
        otp: mfaOtp.trim(),
      })
      const { access_token, refresh_token, role, user_id, name } = res.data
      setSession({
        accessToken: access_token,
        refreshToken: refresh_token,
        role: role ?? portal,
        userId: user_id,
        email: mfaChallenge.email,
        name: name,
      })

      // Route according to role
      if (role === 'ADMIN') navigate('/admin')
      else if (role === 'COMPANY') navigate('/company/jobs')
      else navigate('/opportunities')
    } catch (err: any) {
      setMfaError(err.response?.data?.detail || 'Invalid or expired 2FA code. Please try again.')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleResendMfaCode = async () => {
    setResendMfaLoading(true)
    setResendMfaStatus('')
    setMfaError('')
    try {
      const rawValues = getValues()
      const res = await api.post('/auth/login', {
        ...rawValues,
        email: (mfaChallenge?.email || rawValues.email || '').trim().toLowerCase(),
        portal,
      })
      if (res.data?.mfa_ticket) {
        setMfaChallenge({
          ticket: res.data.mfa_ticket,
          email: res.data.email || mfaChallenge?.email || '',
        })
        setResendMfaStatus('A fresh security code has been sent to your email.')
        setTimeout(() => setResendMfaStatus(''), 6000)
      }
    } catch (err: any) {
      setMfaError(err.response?.data?.detail || 'Failed to resend code. Please return to login.')
    } finally {
      setResendMfaLoading(false)
    }
  }

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setServerError('')
    setResendStatus('')
    try {
      const response = await api.post('/auth/login', {
        ...data,
        email: data.email.trim().toLowerCase(),
        portal,
      })

      // Check if MFA is required for this account
      if (response.data?.mfa_required) {
        setMfaChallenge({
          ticket: response.data.mfa_ticket,
          email: response.data.email,
        })
        setMfaOtp('')
        setMfaError('')
        return
      }

      const { access_token, refresh_token, role, user_id, name } = response.data
      setSession({
        accessToken: access_token,
        refreshToken: refresh_token,
        role: role ?? portal,
        userId: user_id,
        email: data.email,
        name: name,
      })

      // Route according to role
      if (role === 'ADMIN') navigate('/admin')
      else if (role === 'COMPANY') navigate('/company/jobs')
      else navigate('/opportunities')
    } catch (err: any) {
      const detail = err.response?.data?.detail
      if (detail) {
        setServerError(detail)
      } else if (err.response?.status === 404) {
        setServerError('No account registered with this email. Please sign up first.')
      } else if (err.response?.status === 401) {
        setServerError('Incorrect password. Please verify your credentials or use Forgot Password.')
      } else if (err.response?.status === 403) {
        setServerError('Account access restricted or email verification required.')
      } else {
        setServerError('Sign in failed. Please check your credentials and try again.')
      }
    }
  }

  // Render dedicated Two-Factor Authentication challenge UI if active
  if (mfaChallenge) {
    const maskedEmail = mfaChallenge.email.replace(/(.{2})(.*)(?=@)/, (_, a, b) => a + '*'.repeat(Math.max(1, b.length)))
    return (
      <AuthCardLayout
        title="Two-Factor Authentication"
        description="A 6-digit security code was sent to your registered email. Enter it below to complete sign in."
        footer={
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setMfaChallenge(null)
                setMfaOtp('')
                setMfaError('')
              }}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
            >
              ← Back to password sign in
            </button>
          </div>
        }
      >
        <form onSubmit={handleMfaVerify} className="space-y-4">
          <div className="p-3 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="text-xs space-y-0.5">
              <p className="font-semibold text-slate-900 dark:text-white">Security Verification</p>
              <p className="text-slate-500 dark:text-slate-400">
                Code dispatched to <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{maskedEmail}</span>
              </p>
            </div>
          </div>

          {mfaError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{mfaError}</span>
            </div>
          )}

          {resendMfaStatus && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{resendMfaStatus}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              6-Digit Security Code
            </label>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={mfaOtp}
              onChange={(e) => setMfaOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center font-mono text-xl tracking-widest uppercase font-bold"
              autoFocus
            />
          </div>

          <Button type="submit" variant="primary" size="lg" className="w-full" isLoading={mfaLoading}>
            Verify Code & Sign In
          </Button>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">Didn't receive the code?</span>
            <button
              type="button"
              disabled={resendMfaLoading}
              onClick={handleResendMfaCode}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 cursor-pointer"
            >
              {resendMfaLoading ? 'Sending...' : 'Resend Code'}
            </button>
          </div>
        </form>
      </AuthCardLayout>
    )
  }

  return (
    <AuthCardLayout
      title={`Sign In to ${portal === 'STUDENT' ? 'Student Portal' : portal === 'COMPANY' ? 'Recruiter Portal' : 'Admin Console'}`}
      description="Enter your registered credentials to access your dashboard and opportunities."
      footer={
        <div className="text-center space-y-1">
          <p>
            Don't have an account?{' '}
            <Link to="/register-student" className="text-indigo-600 font-semibold hover:underline">
              Join as student
            </Link>{' '}
            or{' '}
            <Link to="/register-company" className="text-indigo-600 font-semibold hover:underline">
              Register company
            </Link>
          </p>
          <p className="text-[11px] text-slate-400">
            Platform operations?{' '}
            <Link to="/register-admin" className="text-purple-600 hover:underline font-semibold">
              Admin setup
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Role Portal Selector */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Select Your Login Portal
          </label>
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setPortal('STUDENT')
                setServerError('')
              }}
              className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                portal === 'STUDENT'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              🎓 Student
            </button>
            <button
              type="button"
              onClick={() => {
                setPortal('COMPANY')
                setServerError('')
              }}
              className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                portal === 'COMPANY'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              🏢 Recruiter
            </button>
            <button
              type="button"
              onClick={() => {
                setPortal('ADMIN')
                setServerError('')
              }}
              className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                portal === 'ADMIN'
                  ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              🛡️ Admin
            </button>
          </div>
        </div>

        {serverError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2 text-xs text-rose-700 font-medium">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
            {serverError.toLowerCase().includes('verification') && (
              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isLoading={resendingVerification}
                  onClick={handleResendVerification}
                  className="w-full text-xs bg-white text-rose-800 border-rose-300 hover:bg-rose-100"
                >
                  Resend Verification Email
                </Button>
              </div>
            )}
          </div>
        )}

        {resendStatus && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{resendStatus}</span>
          </div>
        )}

        <Input
          label="Email address"
          type="email"
          placeholder={portal === 'COMPANY' ? 'recruiter@company.com' : portal === 'ADMIN' ? 'admin@internsphere.internal' : 'student@university.edu'}
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex items-center justify-between text-xs">
          <Link to="/forgot-password" className="text-indigo-600 hover:underline">
            Forgot password?
          </Link>
          <Link to="/verify" className="text-slate-500 hover:underline">
            Verify email
          </Link>
        </div>

        <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
          Sign in as {portal === 'STUDENT' ? 'Student' : portal === 'COMPANY' ? 'Recruiter' : 'Admin'}
        </Button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white dark:bg-slate-900 px-2 text-slate-400 font-medium">Or continue with</span>
          </div>
        </div>

        <GoogleSignInButton role={portal} />
      </form>
    </AuthCardLayout>
  )
}

// --- 2. Student Registration ---

export function StudentRegisterPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof studentRegisterSchema>>({
    resolver: zodResolver(studentRegisterSchema),
    defaultValues: {
      graduation_year: 2026,
    },
  })

  const [createdUser, setCreatedUser] = useState<any>(null)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [emailClassification, setEmailClassification] = useState('')

  const handleEmailBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (!val || !val.includes('@')) {
      setEmailStatus('idle')
      return
    }
    setEmailStatus('checking')
    try {
      const res = await api.post('/auth/check-email', { email: val, role: 'STUDENT' })
      setEmailClassification(res.data.classification || '')
      setEmailStatus(res.data.available ? 'available' : 'taken')
    } catch {
      setEmailStatus('idle')
    }
  }

  const onSubmit = async (data: z.infer<typeof studentRegisterSchema>) => {
    setServerError('')
    try {
      const res = await api.post('/auth/register/student', {
        ...data,
        skills: data.skills || '',
      })
      setCreatedUser(res.data)
    } catch (err: any) {
      if (err.response?.status === 409) {
        setServerError('An account with this email already exists.')
      } else {
        setServerError('Registration failed. Please check the fields and try again.')
      }
    }
  }

  return (
    <AuthCardLayout
      title="Create student account"
      description="Connect with top employers and find your next internship opportunity."
      footer={
        <p className="text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {createdUser ? (
        <div className="p-6 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">Email Verification Sent</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            We sent an email verification link to <strong>{createdUser.email}</strong>.
          </p>
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 font-medium">
            Your verification email has been sent. Check your registered inbox to continue.
          </div>
          <Button variant="primary" className="w-full" onClick={() => navigate('/login')}>
            Proceed to Sign In
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Full name"
            placeholder="Alex Smith"
            error={errors.full_name?.message}
            {...register('full_name')}
          />

          <div>
            <Input
              label="Email address"
              type="email"
              placeholder="alex@university.edu"
              error={emailStatus === 'taken' ? 'This email is already registered. Please sign in instead.' : errors.email?.message}
              {...register('email')}
              onBlur={handleEmailBlur}
            />
            {emailStatus === 'checking' && (
              <p className="text-[11px] text-slate-400 mt-1">Checking email availability...</p>
            )}
            {emailStatus === 'available' && (
              <p className="text-[11px] text-emerald-600 font-medium mt-1">
                ✓ {emailClassification === 'INSTITUTION_EMAIL' ? 'Institutional email detected.' : 'Valid email address.'}
              </p>
            )}
          </div>

          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="University / College"
              placeholder="e.g. UC Berkeley"
              error={errors.university?.message}
              {...register('university')}
            />
            <Input
              label="Major"
              placeholder="Computer Science"
              error={errors.major?.message}
              {...register('major')}
            />
          </div>

          <Input
            label="Graduation Year"
            type="number"
            min={2020}
            max={2100}
            error={errors.graduation_year?.message}
            {...register('graduation_year')}
          />

          <Input
            label="Skills"
            placeholder="React, Python, TypeScript, SQL (comma-separated)"
            helperText="Add your technical or soft skills"
            error={errors.skills?.message}
            {...register('skills')}
          />

          <Textarea
            label="Short Bio (Optional)"
            placeholder="Briefly describe your career interests and background..."
            rows={2}
            error={errors.bio?.message}
            {...register('bio')}
          />

          <Button type="submit" variant="primary" className="w-full mt-2" isLoading={isSubmitting}>
            Create account
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-900 px-2 text-slate-400 font-medium">Or register with</span>
            </div>
          </div>

          <GoogleSignInButton role="STUDENT" buttonText="Sign up with Google" />
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 3. Company Registration ---

export function CompanyRegisterPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')
  const [createdCompany, setCreatedCompany] = useState<any>(null)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [emailClassification, setEmailClassification] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof companyRegisterSchema>>({
    resolver: zodResolver(companyRegisterSchema),
  })

  const handleEmailBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (!val || !val.includes('@')) {
      setEmailStatus('idle')
      return
    }
    setEmailStatus('checking')
    try {
      const res = await api.post('/auth/check-email', { email: val, role: 'COMPANY' })
      if (!res.data.available) {
        setEmailStatus('taken')
        if (res.data.reason) {
          setServerError(res.data.reason)
        }
      } else {
        setEmailClassification(res.data.classification || '')
        setEmailStatus('available')
        setServerError('')
      }
    } catch {
      setEmailStatus('idle')
    }
  }

  const onSubmit = async (data: z.infer<typeof companyRegisterSchema>) => {
    setServerError('')
    try {
      const res = await api.post('/auth/register/company', {
        ...data,
        email: data.email.trim().toLowerCase(),
        website: data.website || null,
        description: data.description || null,
      })
      setCreatedCompany(res.data)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      if (detail) {
        setServerError(detail)
      } else if (err.response?.status === 409) {
        setServerError('An account with this email is already registered.')
      } else {
        setServerError('Company registration failed. Please verify the information entered.')
      }
    }
  }

  return (
    <AuthCardLayout
      title="Register your company"
      description="Post internship roles and recruit talented students for your team."
      footer={
        <p className="text-center">
          Already registered?{' '}
          <Link to="/login" className="text-indigo-600 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      {createdCompany ? (
        <div className="p-6 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">Email Verification Sent</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            We sent an email verification link to <strong>{createdCompany.email}</strong>. Please check your corporate inbox to activate your recruiter account.
          </p>
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 font-medium">
            Your verification email has been sent. Check your registered inbox to continue.
          </div>
          <Button variant="primary" className="w-full" onClick={() => navigate('/login')}>
            Proceed to Sign In
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Company name"
            placeholder="Acme Inc."
            error={errors.company_name?.message}
            {...register('company_name')}
          />

          <div>
            <Input
              label="Corporate Work Email"
              type="email"
              placeholder="recruiter@acme.com"
              helperText="Must be your official corporate work email"
              error={
                emailStatus === 'taken'
                  ? 'This email is already registered. Please sign in instead.'
                  : errors.email?.message
              }
              {...register('email')}
              onBlur={handleEmailBlur}
            />
            {emailStatus === 'checking' && (
              <p className="text-[11px] text-slate-400 mt-1">Checking email availability and domain eligibility...</p>
            )}
            {emailStatus === 'available' && (
              <p className="text-[11px] text-emerald-600 font-medium mt-1">
                ✓ {emailClassification === 'INSTITUTION_EMAIL' ? 'Institutional organization email detected.' : 'Organization email detected.'}
              </p>
            )}
          </div>

          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />

          <Input
            label="Industry"
            placeholder="e.g. Software, Healthcare, Fintech"
            error={errors.industry?.message}
            {...register('industry')}
          />

          <Input
            label="Company website"
            type="url"
            placeholder="https://acme.com"
            error={errors.website?.message}
            {...register('website')}
          />

          <Textarea
            label="About company"
            placeholder="Brief overview of company mission and products..."
            rows={2}
            error={errors.description?.message}
            {...register('description')}
          />

          <Button type="submit" variant="primary" className="w-full mt-2" isLoading={isSubmitting}>
            Register organization
          </Button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-900 px-2 text-slate-400 font-medium">Or register with</span>
            </div>
          </div>

          <GoogleSignInButton role="COMPANY" buttonText="Sign up with Google" />
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 4. Admin Registration ---

export function AdminRegisterPage() {
  const navigate = useNavigate()
  const [successMsg, setSuccessMsg] = useState('')
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof adminRegisterSchema>>({
    resolver: zodResolver(adminRegisterSchema),
  })

  const onSubmit = async (data: z.infer<typeof adminRegisterSchema>) => {
    setServerError('')
    try {
      await api.post('/auth/register/admin', data)
      setSuccessMsg('Administrator account provisioned successfully.')
      setTimeout(() => navigate('/login'), 1500)
    } catch {
      setServerError('Admin registration failed. Please ensure the admin bootstrap key is correct.')
    }
  }

  return (
    <AuthCardLayout
      title="Provision Admin Account"
      description="Enter the secret bootstrap key to register platform oversight administrator."
      footer={
        <Link to="/login" className="text-slate-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {successMsg ? (
        <div className="p-6 text-center space-y-3">
          <ShieldCheck className="w-12 h-12 text-purple-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">Admin Account Active</h3>
          <p className="text-xs text-slate-600">{successMsg}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Admin email"
            type="email"
            placeholder="admin@platform.internal"
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />

          <Input
            label="Admin Signup Key"
            type="password"
            placeholder="Enter secure bootstrap key"
            helperText="Matches ADMIN_SIGNUP_KEY in server environment"
            error={errors.signup_key?.message}
            {...register('signup_key')}
          />

          <Button type="submit" variant="primary" className="w-full bg-purple-600 hover:bg-purple-700" isLoading={isSubmitting}>
            Provision Administrator
          </Button>
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 5. Forgot Password ---

// --- 5. Forgot Password & OTP Reset ---

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendStatus, setResendStatus] = useState('')

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')
    if (!email || !email.includes('@')) {
      setServerError('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() })
      setStep('verify')
    } catch (err: any) {
      const detail = err.response?.data?.detail
      if (detail) {
        setServerError(detail)
      } else if (err.response?.status === 404) {
        setServerError(`No account found with email '${email}'. Please check for typos or register.`)
      } else {
        setServerError('Failed to dispatch verification code. Please check the email and try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResend = async () => {
    if (resending || !email) return
    setResending(true)
    setResendStatus('')
    setServerError('')
    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() })
      setResendStatus(res.data?.message || 'A fresh verification code has been dispatched!')
      setTimeout(() => setResendStatus(''), 4000)
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Could not resend code. Please try again.'
      setServerError(detail)
    } finally {
      setResending(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    const cleanOtp = otp.trim()
    if (!cleanOtp || cleanOtp.length !== 6 || !/^\d+$/.test(cleanOtp)) {
      setServerError('Please enter the 6-digit numeric verification code.')
      return
    }

    if (newPassword.length < 8) {
      setServerError('New password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setServerError('Passwords do not match. Please re-enter.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.post('/auth/reset-password', {
        email: email.trim().toLowerCase(),
        otp: cleanOtp,
        new_password: newPassword,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setServerError(detail || 'Verification code is invalid or has expired. Please request a new one.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthCardLayout
      title={step === 'request' ? 'Reset your password' : 'Enter Verification Code'}
      description={
        step === 'request'
          ? 'Enter your registered email address and we will dispatch a 6-digit verification code.'
          : `We dispatched a 6-digit verification OTP to ${email}.`
      }
      footer={
        <Link to="/login" className="text-indigo-600 hover:underline">
          Return to sign in
        </Link>
      }
    >
      {success ? (
        <div className="p-6 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">Password Reset Complete!</h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Your account password has been safely updated. You can now sign in with your new credentials.
          </p>
          <Button variant="primary" className="w-full mt-2" onClick={() => navigate('/login')}>
            Sign In Now
          </Button>
        </div>
      ) : step === 'request' ? (
        <form onSubmit={handleSendOtp} className="space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Account email address"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-lg text-xs text-indigo-800 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-indigo-900">
              <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
              <span>Instant OTP Verification</span>
            </div>
            <p className="text-[11px] text-indigo-700 leading-relaxed">
              We will generate a secure 6-digit verification code valid for 15 minutes. Check the inbox for your registered email address.
            </p>
          </div>

          <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
            Send Verification Code
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          {resendStatus && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{resendStatus}</span>
            </div>
          )}

          {/* Password reset delivery status */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 dark:text-slate-300">
                Code sent to: <strong className="text-slate-900 dark:text-white">{email}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  setStep('request')
                  setServerError('')
                }}
                className="text-indigo-600 hover:underline text-[11px] font-medium"
              >
                Change
              </button>
            </div>

          </div>

          {/* 6-Digit OTP Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              6-Digit Verification Code *
            </label>
            <input
              type="text"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="flex h-12 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xl font-mono text-center tracking-[0.5em] font-bold text-slate-900 dark:text-white placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">Enter the 6-digit number received in your email.</p>
          </div>

          {/* New Password */}
          <Input
            label="New password"
            type="password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          {/* Confirm Password */}
          <Input
            label="Confirm new password"
            type="password"
            placeholder="Repeat new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
            Reset & Update Password
          </Button>

          <div className="flex items-center justify-between text-xs pt-1">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="text-slate-500 hover:text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
            >
              {resending ? 'Sending fresh code...' : "Didn't receive code? Resend"}
            </button>
            <Link to="/login" className="text-slate-500 hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 6. Reset Password ---

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const emailFromUrl = searchParams.get('email') || ''
  const otpFromUrl = searchParams.get('otp') || searchParams.get('token') || ''

  const [email, setEmail] = useState(emailFromUrl)
  const [otp, setOtp] = useState(otpFromUrl)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (emailFromUrl) setEmail(emailFromUrl)
    if (otpFromUrl) setOtp(otpFromUrl)
  }, [emailFromUrl, otpFromUrl])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setServerError('')

    const cleanCode = otp.trim()
    if (!cleanCode) {
      setServerError('Verification code or reset token is required.')
      return
    }

    if (newPassword.length < 8) {
      setServerError('Password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setServerError('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    try {
      await api.post('/auth/reset-password', {
        email: email.trim().toLowerCase() || undefined,
        otp: cleanCode,
        token: cleanCode,
        new_password: newPassword,
      })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch (err: any) {
      const detail = err.response?.data?.detail
      setServerError(detail || 'Invalid or expired verification code. Please request a new link.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthCardLayout
      title="Set new password"
      description="Provide your verification code and choose a new password for your account."
      footer={
        <Link to="/login" className="text-indigo-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {success ? (
        <div className="p-6 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900">Password Reset Complete</h3>
          <p className="text-xs text-slate-600">Your password has been changed. Redirecting to login...</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {otpFromUrl && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-lg flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Reset link verified for <strong>{emailFromUrl || 'your account'}</strong>. Please choose your new password.</span>
            </div>
          )}

          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Account email (optional if link contained token)"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Input
            label="6-Digit OTP or Reset Token"
            placeholder="Enter 6-digit code or paste token"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
          />

          <Input
            label="New password"
            type="password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          <Input
            label="Confirm new password"
            type="password"
            placeholder="Repeat new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 7. Verify Email Page ---

export function VerifyEmailPage() {
  const { token: routeToken } = useParams()
  const [tokenInput, setTokenInput] = useState(routeToken || '')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const executeVerify = async (tok: string) => {
    if (!tok.trim()) return
    setStatus('loading')
    setMessage('')
    try {
      const res = await api.get(`/auth/verify/${tok.trim()}`)
      setStatus('success')
      setMessage(res.data.message || 'Your email has been verified!')
    } catch {
      setStatus('error')
      setMessage('Invalid or expired verification token.')
    }
  }

  useEffect(() => {
    if (routeToken) {
      executeVerify(routeToken)
    }
  }, [routeToken])

  return (
    <AuthCardLayout
      title="Email Verification"
      description="Confirm your email to complete registration."
      footer={
        <Link to="/login" className="text-indigo-600 hover:underline">
          Go to sign in
        </Link>
      }
    >
      <div className="space-y-4 text-center">
        {status === 'success' ? (
          <div className="p-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <h3 className="text-base font-semibold text-slate-900">Email Verified!</h3>
            <p className="text-xs text-slate-600">{message}</p>
            <div className="pt-3">
              <Link to="/login">
                <Button variant="primary" size="sm">
                  Proceed to Sign in
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-left">
            {status === 'error' && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <Input
              label="Verification token"
              placeholder="Paste the verification token from your email"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />

            <Button
              type="button"
              variant="primary"
              className="w-full"
              isLoading={status === 'loading'}
              onClick={() => executeVerify(tokenInput)}
            >
              Verify account
            </Button>
          </div>
        )}
      </div>
    </AuthCardLayout>
  )
}