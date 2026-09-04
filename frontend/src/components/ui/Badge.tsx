import React from 'react'
import { cn } from '../../lib/utils'

export type BadgeVariant =
  | 'default'
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'purple'
  | 'rose'
  | 'blue'
  | 'slate'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  status?: string
}

export function Badge({ className, variant, status, children, ...props }: BadgeProps) {
  // Infer variant from status if provided
  let resolvedVariant: BadgeVariant = variant || 'default'

  if (status) {
    const s = status.toUpperCase()
    if (['PUBLISHED', 'SELECTED', 'VERIFIED', 'COMPLETED', 'ACTIVE'].includes(s)) {
      resolvedVariant = 'emerald'
    } else if (['PENDING', 'PENDING_APPROVAL', 'UNDER_REVIEW', 'RESCHEDULED'].includes(s)) {
      resolvedVariant = 'amber'
    } else if (['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SCHEDULED', 'COMPANY'].includes(s)) {
      resolvedVariant = 'indigo'
    } else if (['STUDENT'].includes(s)) {
      resolvedVariant = 'emerald'
    } else if (['ADMIN', 'INVESTIGATING'].includes(s)) {
      resolvedVariant = 'purple'
    } else if (['REJECTED', 'CANCELLED', 'SUSPENDED', 'CLOSED'].includes(s)) {
      resolvedVariant = 'rose'
    } else if (['APPLIED'].includes(s)) {
      resolvedVariant = 'blue'
    } else if (['DRAFT', 'WITHDRAWN', 'OPEN'].includes(s)) {
      resolvedVariant = 'slate'
    }
  }

  const variantStyles: Record<BadgeVariant, string> = {
    default: 'bg-slate-100 text-slate-700 border-slate-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
  }

  const formattedContent = children || (status ? status.replace(/_/g, ' ') : '')

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border capitalize whitespace-nowrap',
        variantStyles[resolvedVariant],
        className
      )}
      {...props}
    >
      {formattedContent}
    </span>
  )
}
