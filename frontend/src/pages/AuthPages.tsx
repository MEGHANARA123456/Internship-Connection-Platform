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
import { CheckCircle2, AlertCircle, ShieldCheck, Mail } from 'lucide-react'

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

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email'),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  new_password: z.string().min(8, 'Password must be at least 8 characters long'),
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
            <div className="mx-auto w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-base shadow-xs mb-2">
              IC
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
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    setServerError('')
    try {
      const response = await api.post('/auth/login', data)
      const { access_token, refresh_token, role, user_id } = response.data
      setSession({
        accessToken: access_token,
        refreshToken: refresh_token,
        role: role ?? 'STUDENT',
        userId: user_id,
        email: data.email,
      })

      // Route according to role
      if (role === 'ADMIN') navigate('/admin')
      else if (role === 'COMPANY') navigate('/company/jobs')
      else navigate('/opportunities')
    } catch {
      setServerError('Invalid email or password. Please check your credentials.')
    }
  }

  return (
    <AuthCardLayout
      title="Welcome back"
      description="Sign in to your account to manage your internships and applications."
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
        {serverError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <Input
          label="Email address"
          type="email"
          placeholder="you@example.com"
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
          Sign in
        </Button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-slate-800" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white dark:bg-slate-900 px-2 text-slate-400 font-medium">Or continue with</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            alert('Google Single Sign-On: Redirecting to Google OAuth2 consent screen...')
          }}
          className="w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 font-semibold text-xs flex items-center justify-center gap-2.5 transition-all shadow-2xs hover:shadow-xs cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          Continue with Google
        </button>
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
  const [verifying, setVerifying] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')

  const handleEmailBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const val = e.target.value.trim()
    if (!val || !val.includes('@')) {
      setEmailStatus('idle')
      return
    }
    setEmailStatus('checking')
    try {
      const res = await api.post('/auth/check-email', { email: val })
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
            Local Mailbox: Check <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="underline font-bold">Mailpit (Port 8025)</a> for local emails.
          </div>
          {createdUser.verification_token ? (
            <Button
              variant="primary"
              className="w-full"
              isLoading={verifying}
              onClick={async () => {
                setVerifying(true)
                try {
                  await api.get(`/auth/verify/${createdUser.verification_token}`)
                  navigate('/login')
                } catch {
                  navigate('/login')
                } finally {
                  setVerifying(false)
                }
              }}
            >
              Instant 1-Click Email Verify & Continue
            </Button>
          ) : (
            <Button variant="primary" className="w-full" onClick={() => navigate('/login')}>
              Proceed to Sign In
            </Button>
          )}
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
              <p className="text-[11px] text-emerald-600 font-medium mt-1">✓ Email address is valid and available</p>
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
  const [verifying, setVerifying] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')

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
      const res = await api.post('/auth/check-email', { email: val })
      setEmailStatus(res.data.available ? 'available' : 'taken')
    } catch {
      setEmailStatus('idle')
    }
  }

  const onSubmit = async (data: z.infer<typeof companyRegisterSchema>) => {
    setServerError('')
    try {
      const res = await api.post('/auth/register/company', {
        ...data,
        website: data.website || null,
        description: data.description || null,
      })
      setCreatedCompany(res.data)
    } catch (err: any) {
      if (err.response?.status === 409) {
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
            We sent an email verification link to <strong>{createdCompany.email}</strong>.
          </p>
          <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 font-medium">
            Local Mailbox: Check <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="underline font-bold">Mailpit (Port 8025)</a> for local emails.
          </div>
          {createdCompany.verification_token ? (
            <Button
              variant="primary"
              className="w-full"
              isLoading={verifying}
              onClick={async () => {
                setVerifying(true)
                try {
                  await api.get(`/auth/verify/${createdCompany.verification_token}`)
                  navigate('/login')
                } catch {
                  navigate('/login')
                } finally {
                  setVerifying(false)
                }
              }}
            >
              Instant 1-Click Email Verify & Continue
            </Button>
          ) : (
            <Button variant="primary" className="w-full" onClick={() => navigate('/login')}>
              Proceed to Sign In
            </Button>
          )}
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
            label="Company name"
            placeholder="Acme Inc."
            error={errors.company_name?.message}
            {...register('company_name')}
          />

          <div>
            <Input
              label="Work email"
              type="email"
              placeholder="recruiter@acme.com"
              error={emailStatus === 'taken' ? 'This email is already registered. Please sign in instead.' : errors.email?.message}
              {...register('email')}
              onBlur={handleEmailBlur}
            />
            {emailStatus === 'checking' && (
              <p className="text-[11px] text-slate-400 mt-1">Checking email availability...</p>
            )}
            {emailStatus === 'available' && (
              <p className="text-[11px] text-emerald-600 font-medium mt-1">✓ Email address is valid and available</p>
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

export function ForgotPasswordPage() {
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  const onSubmit = async (data: z.infer<typeof forgotPasswordSchema>) => {
    setServerError('')
    try {
      await api.post('/auth/forgot-password', data)
      setSuccess(true)
    } catch {
      setServerError('An error occurred. Please try again.')
    }
  }

  return (
    <AuthCardLayout
      title="Reset your password"
      description="Enter your account email and we will send password reset instructions."
      footer={
        <Link to="/login" className="text-indigo-600 hover:underline">
          Return to sign in
        </Link>
      }
    >
      {success ? (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center space-y-2 text-emerald-800">
          <Mail className="w-8 h-8 text-emerald-600 mx-auto" />
          <h4 className="text-sm font-semibold">Reset Email Sent</h4>
          <p className="text-xs text-emerald-700">
            If an account exists for that email, a password reset token has been dispatched. Please check Mailpit (port 8025).
          </p>
          <div className="pt-2">
            <Link to="/reset-password">
              <Button size="sm" variant="outline">
                Enter reset token
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Account email"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isSubmitting}>
            Send reset instructions
          </Button>
        </form>
      )}
    </AuthCardLayout>
  )
}

// --- 6. Reset Password ---

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tokenFromUrl = searchParams.get('token') || ''
  const [success, setSuccess] = useState(false)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: tokenFromUrl,
    },
  })

  const onSubmit = async (data: z.infer<typeof resetPasswordSchema>) => {
    setServerError('')
    try {
      await api.post('/auth/reset-password', data)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2000)
    } catch {
      setServerError('Invalid or expired reset token. Please request a new link.')
    }
  }

  return (
    <AuthCardLayout
      title="Set new password"
      description="Provide your reset token and choose a new password for your account."
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          <Input
            label="Reset Token"
            placeholder="Paste token from email"
            error={errors.token?.message}
            {...register('token')}
          />

          <Input
            label="New password"
            type="password"
            placeholder="At least 8 characters"
            error={errors.new_password?.message}
            {...register('new_password')}
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
              placeholder="Paste verification token from Mailpit"
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