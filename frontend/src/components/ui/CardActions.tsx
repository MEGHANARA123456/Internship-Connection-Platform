import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from '../../lib/utils'

type CardActionIntent = 'primary' | 'outline' | 'danger'

const intentStyles: Record<CardActionIntent, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500 shadow-xs',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-500 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40',
}

export function CardActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col items-end gap-2 self-start md:w-56 md:self-center', className)}>
      {children}
    </div>
  )
}

export function CardActionsRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid w-full grid-cols-2 gap-2', className)}>
      {children}
    </div>
  )
}

export function CardActionButton({
  intent = 'outline',
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { intent?: CardActionIntent }) {
  return (
    <Button
      size="md"
      variant={intent === 'primary' ? 'primary' : intent === 'danger' ? 'danger' : 'outline'}
      className={cn(
        'h-10 w-full min-w-0 rounded-xl px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50',
        intentStyles[intent],
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )
}
