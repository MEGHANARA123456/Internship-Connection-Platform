import { Link } from 'react-router-dom'

interface LogoProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
  linkToHome?: boolean
  subtitle?: string
}

export function Logo({
  className = '',
  size = 'md',
  showText = true,
  linkToHome = true,
  subtitle,
}: LogoProps) {
  const sizeClasses = {
    sm: {
      icon: 'w-7 h-7 rounded-lg',
      svg: 'w-4 h-4',
      text: 'text-base',
      sub: 'text-[9px]',
    },
    md: {
      icon: 'w-8.5 h-8.5 rounded-xl',
      svg: 'w-5 h-5',
      text: 'text-lg',
      sub: 'text-[10px]',
    },
    lg: {
      icon: 'w-11 h-11 rounded-2xl',
      svg: 'w-6.5 h-6.5',
      text: 'text-2xl',
      sub: 'text-xs',
    },
  }[size]

  const LogoIcon = (
    <div
      className={`relative ${sizeClasses.icon} bg-gradient-to-tr from-indigo-700 via-indigo-600 to-violet-500 text-white flex items-center justify-center shadow-sm shadow-indigo-500/25 ring-1 ring-white/20 shrink-0 group-hover:scale-105 transition-transform duration-200`}
    >
      {/* 3D Sphere SVG Logo Mark */}
      <svg
        className={`${sizeClasses.svg} text-white drop-shadow-xs`}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer orbital ring */}
        <ellipse
          cx="12"
          cy="12"
          rx="10"
          ry="4.5"
          transform="rotate(-25 12 12)"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="1.5 2"
          opacity="0.85"
        />
        {/* Core Sphere */}
        <circle
          cx="12"
          cy="12"
          r="6.8"
          fill="url(#sphereGradient)"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        {/* Central Latitudinal Swirl */}
        <path
          d="M6 12C6 12 8.5 15 12 15C15.5 15 18 12 18 12"
          stroke="white"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.9"
        />
        {/* Longitudinal meridian */}
        <ellipse
          cx="12"
          cy="12"
          rx="3.2"
          ry="6.8"
          stroke="white"
          strokeWidth="1.1"
          opacity="0.6"
        />
        {/* Glowing focal pulse dot */}
        <circle cx="16" cy="8.5" r="1.3" fill="#ffffff" />
        <defs>
          <linearGradient id="sphereGradient" x1="6" y1="6" x2="18" y2="18" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6366f1" />
            <stop offset="1" stopColor="#4338ca" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )

  const LogoContent = (
    <div className={`inline-flex items-center gap-2.5 select-none ${className} group`}>
      {LogoIcon}
      {showText && (
        <div className="flex flex-col leading-none">
          <span
            className={`${sizeClasses.text} font-black tracking-tight text-slate-900 dark:text-white flex items-center`}
          >
            <span>Intern</span>
            <span className="bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500 bg-clip-text text-transparent ml-0.5">
              Sphere
            </span>
          </span>
          {subtitle && (
            <span className={`${sizeClasses.sub} font-medium text-slate-500 dark:text-slate-400 mt-0.5 tracking-normal`}>
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )

  if (linkToHome) {
    return (
      <Link to="/" className="inline-flex items-center group transition-opacity hover:opacity-95">
        {LogoContent}
      </Link>
    )
  }

  return LogoContent
}
