import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  'aria-label': string
  title?: string
  variant?: 'default' | 'primary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({
    icon: Icon,
    variant = 'default',
    size = 'md',
    isLoading = false,
    disabled,
    className,
    title,
    'aria-label': ariaLabel,
    type = 'button',
    ...props
  }, ref) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      aria-busy={isLoading || undefined}
      title={title ?? ariaLabel}
      disabled={disabled || isLoading}
      className={cn(
        'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-offset-slate-950',
        {
          default: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
          primary: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-900/70',
          danger: 'text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-300',
        }[variant],
        {
          sm: 'h-9 w-9',
          md: 'h-10 w-10',
          lg: 'h-11 w-11',
        }[size],
        className,
      )}
    >
      {isLoading
        ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        : <Icon aria-hidden="true" className="h-4 w-4" />}
    </button>
  ),
)

IconButton.displayName = 'IconButton'
