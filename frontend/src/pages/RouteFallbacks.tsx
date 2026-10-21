import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Home } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { routes } from '../lib/routes'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">That address doesn&apos;t match a page in InternSphere.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={() => navigate(-1)} leftIcon={<ArrowLeft className="h-4 w-4" />}>Back</Button>
        <Link to={routes.home}><Button variant="primary" leftIcon={<Home className="h-4 w-4" />}>Home</Button></Link>
      </div>
    </main>
  )
}
