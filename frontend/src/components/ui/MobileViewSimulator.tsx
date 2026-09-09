import type { ReactNode } from 'react'
import { useViewModeStore } from '../../store/viewMode'
import { Smartphone, Monitor, Sparkles } from 'lucide-react'

export function MobileViewSimulator({ children }: { children: ReactNode }) {
  const { isMobileView, toggleMobileView } = useViewModeStore()

  if (!isMobileView) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-slate-950/90 text-slate-100 flex flex-col items-center py-4 px-2 relative transition-all animate-in fade-in duration-200">
      {/* Top Floating Mobile View Control Header */}
      <div className="w-full max-w-lg mb-3 flex items-center justify-between bg-slate-900/90 border border-slate-700/70 backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-xl z-50">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-600/30 text-indigo-400 rounded-lg border border-indigo-500/40">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-wide">Mobile View Active</span>
              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold rounded-full border border-emerald-500/30 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> 390 × 844
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Previewing authentic touch & compact layout</p>
          </div>
        </div>

        <button
          onClick={toggleMobileView}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md hover:shadow-indigo-500/25 cursor-pointer"
          title="Exit Mobile View"
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>Exit to Desktop</span>
        </button>
      </div>

      {/* Realistic Smartphone Chassis Frame */}
      <div className="relative w-full max-w-[410px] h-[850px] max-h-[calc(100vh-100px)] bg-slate-900 rounded-[50px] p-3 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8),0_0_0_4px_rgba(51,65,85,0.7)] border-4 border-slate-700 flex flex-col shrink-0">
        {/* Hardware details: Side buttons styling */}
        <div className="absolute -left-[7px] top-24 w-[3px] h-10 bg-slate-700 rounded-l-md" />
        <div className="absolute -left-[7px] top-38 w-[3px] h-12 bg-slate-700 rounded-l-md" />
        <div className="absolute -left-[7px] top-52 w-[3px] h-12 bg-slate-700 rounded-l-md" />
        <div className="absolute -right-[7px] top-32 w-[3px] h-16 bg-slate-700 rounded-r-md" />

        {/* Dynamic Island / Top Notch */}
        <div className="w-full flex items-center justify-between px-6 py-1 shrink-0 z-40 bg-white dark:bg-slate-950 rounded-t-[38px]">
          <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">9:41</span>
          <div className="w-24 h-5 bg-black rounded-full flex items-center justify-center gap-2 px-2 shadow-inner">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-900 border border-slate-800" />
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/70 animate-pulse" />
          </div>
          <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L12 22l7.03-4.39C20.26 16.07 21 14.12 21 12c0-4.97-4.03-9-9-9z"/>
            </svg>
            <div className="w-4 h-2 rounded-[2px] border border-current flex items-center p-0.5">
              <div className="w-full h-full bg-current rounded-[1px]" />
            </div>
          </div>
        </div>

        {/* Mobile Viewport Screen */}
        <div className="flex-1 w-full bg-slate-50 dark:bg-slate-950 rounded-b-[38px] overflow-y-auto overflow-x-hidden relative flex flex-col shadow-inner">
          <div className="w-full flex-1 flex flex-col">
            {children}
          </div>
        </div>

        {/* Home Indicator Bar */}
        <div className="w-full py-1.5 flex justify-center shrink-0">
          <div className="w-32 h-1 bg-slate-500/60 rounded-full" />
        </div>
      </div>
    </div>
  )
}
