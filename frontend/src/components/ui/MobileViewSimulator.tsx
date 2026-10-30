import { useState, useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react'
import { useViewModeStore } from '../../store/viewMode'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Smartphone,
  RotateCw,
  RefreshCw,
  Check,
  ChevronDown,
  Sparkles,
  X,
} from 'lucide-react'

interface DevicePreset {
  id: string
  name: string
  width: number
  height: number
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'actual', name: 'Actual size', width: 0, height: 0 },
  { id: 'laptop', name: 'Laptop', width: 1280, height: 900 },
  { id: 'tablet', name: 'Tablet', width: 768, height: 1024 },
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667 },
  { id: 'pixel', name: 'Pixel', width: 412, height: 915 },
  { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
]

export function MobileViewSimulator({ children }: { children: ReactNode }) {
  const { isMobileView, toggleMobileView } = useViewModeStore()
  const [selectedDevice, setSelectedDevice] = useState<DevicePreset>(() => {
    if (typeof window === 'undefined') return DEVICE_PRESETS.find((preset) => preset.id === 'mobile')!
    const id = window.sessionStorage.getItem('screen-preview-size')
    return DEVICE_PRESETS.find((preset) => preset.id === id)
      ?? DEVICE_PRESETS.find((preset) => preset.id === 'mobile')!
  })
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [frameMode, setFrameMode] = useState<'hardware' | 'clean'>('hardware')
  const [scale, setScale] = useState<number | 'auto'>('auto')
  const [deviceDropdownOpen, setDeviceDropdownOpen] = useState(false)
  const [iframeKey, setIframeKey] = useState(0)
  const [frameState, setFrameState] = useState({ identity: '', loading: true, error: false })
  const [currentTime, setCurrentTime] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const isInsidePreviewFrame = typeof window !== 'undefined'
    && (window.self !== window.top || new URLSearchParams(window.location.search).has('preview'))

  useEffect(() => {
    if (!isInsidePreviewFrame) return
    const route = new URLSearchParams(location.search)
    route.delete('preview')
    const query = route.toString()
    window.parent.postMessage({
      type: 'internsphere:preview-route',
      path: `${location.pathname}${query ? `?${query}` : ''}`,
    }, window.location.origin)
  }, [isInsidePreviewFrame, location.pathname, location.search])

  useEffect(() => {
    if (!isMobileView || isInsidePreviewFrame) return
    const syncFrameRoute = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source === window) return
      if (event.data?.type !== 'internsphere:preview-route' || typeof event.data.path !== 'string') return
      if (!event.data.path.startsWith('/') || event.data.path.startsWith('//')) return
      const [path, search = ''] = event.data.path.split('?')
      if (`${location.pathname}${location.search}` !== event.data.path) {
        navigate(`${path}${search ? `?${search}` : ''}`)
      }
    }
    window.addEventListener('message', syncFrameRoute)
    return () => window.removeEventListener('message', syncFrameRoute)
  }, [isInsidePreviewFrame, isMobileView, location.pathname, location.search, navigate])

  useEffect(() => {
    if (!isMobileView || isInsidePreviewFrame) return
    window.dispatchEvent(new CustomEvent('internsphere:preview-state', { detail: { open: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('internsphere:preview-state', { detail: { open: false } }))
    }
  }, [isInsidePreviewFrame, isMobileView])

  // Live real-time clock for realistic status bar
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 10000)
    return () => clearInterval(timer)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!deviceDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDeviceDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [deviceDropdownOpen])

  // ESC key to exit mobile preview
  useEffect(() => {
    if (!isMobileView || isInsidePreviewFrame) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleMobileView()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileView, isInsidePreviewFrame, toggleMobileView])

  if (!isMobileView || isInsidePreviewFrame) {
    return <>{children}</>
  }

  const previewUrl = typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search ? `${window.location.search}&` : '?'}preview=1`
    : '/'
  const frameIdentity = `${iframeKey}-${location.pathname}${location.search}`
  const isFrameLoading = frameState.identity !== frameIdentity || frameState.loading
  const frameError = frameState.identity === frameIdentity && frameState.error

  const isPortrait = orientation === 'portrait'
  const previewWidth = selectedDevice.id === 'actual' ? window.innerWidth : selectedDevice.width
  const previewHeight = selectedDevice.id === 'actual' ? window.innerHeight : selectedDevice.height
  const activeWidth = isPortrait ? previewWidth : previewHeight
  const activeHeight = isPortrait ? previewHeight : previewWidth

  // Auto-fit scale computation so the phone frame never clips vertically on standard displays
  const computedScale =
    scale === 'auto'
      ? typeof window !== 'undefined'
        ? Math.min(1, Math.max(0.7, (window.innerHeight - 130) / (activeHeight + (frameMode === 'hardware' ? 50 : 0))))
        : 0.9
      : scale

  const handleReload = () => {
    setIframeKey((prev) => prev + 1)
  }

  const handleFrameLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    let error = false
    try {
      const frameLocation = event.currentTarget.contentWindow?.location
      if (!frameLocation || frameLocation.href === 'about:blank' || frameLocation.origin !== window.location.origin) {
        error = true
      }
    } catch {
      error = true
    }
    setFrameState({ identity: frameIdentity, loading: false, error })
  }

  const handleFrameError = () => {
    setFrameState({ identity: frameIdentity, loading: false, error: true })
  }

  const renderPreviewFrame = (title: string, width: number, height: number) => (
    <>
      <iframe
        key={`${iframeKey}-${previewUrl}`}
        src={previewUrl}
        title={title}
        width={width}
        height={height}
        className="absolute inset-0 h-full w-full border-0"
        onLoad={handleFrameLoad}
        onError={handleFrameError}
      />
      {isFrameLoading && !frameError && (
        <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/95 text-sm font-medium text-slate-600 dark:bg-slate-950/95 dark:text-slate-300">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" aria-hidden="true" />
          <span>Loading preview…</span>
        </div>
      )}
      {frameError && (
        <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center text-sm text-slate-700 dark:bg-slate-950 dark:text-slate-200">
          <strong>Preview couldn’t be displayed.</strong>
          <span>This page may block embedding or may have failed to load. Reload the preview or open the page directly.</span>
        </div>
      )}
    </>
  )

  const toggleOrientation = () => {
    setOrientation((prev) => (prev === 'portrait' ? 'landscape' : 'portrait'))
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start py-3 px-3 select-none overflow-x-hidden antialiased">
      {/* Executive Studio Inspector Header */}
      <header className="w-full max-w-4xl mb-4 flex flex-wrap items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 backdrop-blur-xl px-4 py-2.5 rounded-2xl shadow-2xl z-50">
        {/* Left: Device & Dimensions */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20">
            <Smartphone className="w-4 h-4" />
          </div>

          {/* Device Selector Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDeviceDropdownOpen(!deviceDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-white transition-all cursor-pointer shadow-xs"
            >
              <span>{selectedDevice.name}</span>
              <span className="text-[11px] text-slate-400 font-mono">
                {activeWidth} × {activeHeight}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {deviceDropdownOpen && (
              <div className="absolute left-0 top-full mt-2 w-56 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-1.5 z-50 text-xs space-y-1 backdrop-blur-xl">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Select Device Frame
                </div>
                {DEVICE_PRESETS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setSelectedDevice(d)
                      window.sessionStorage.setItem('screen-preview-size', d.id)
                      setDeviceDropdownOpen(false)
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left cursor-pointer transition-colors ${
                      selectedDevice.id === d.id
                        ? 'bg-indigo-600/20 text-indigo-400 font-bold border border-indigo-500/30'
                        : 'text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <div>
                      <p className="font-medium">{d.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                            {d.id === 'actual' ? 'Current viewport' : `${d.width} × ${d.height} px`}
                      </p>
                    </div>
                    {selectedDevice.id === d.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/70 border border-slate-700/60 text-[11px] text-slate-300">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Responsive 1:1 Engine</span>
          </div>
        </div>

        {/* Center/Right: Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Frame Style Toggle */}
          <div className="flex items-center rounded-xl bg-slate-800/80 p-0.5 border border-slate-700/60 text-xs">
            <button
              onClick={() => setFrameMode('hardware')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                frameMode === 'hardware'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Show device frame"
            >
              Hardware Shell
            </button>
            <button
              onClick={() => setFrameMode('clean')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                frameMode === 'clean'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Clean borderless viewport"
            >
              Clean Canvas
            </button>
          </div>

          {/* Orientation Toggle */}
          <button
            onClick={toggleOrientation}
            className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-all cursor-pointer"
            title={`Rotate to ${orientation === 'portrait' ? 'Landscape' : 'Portrait'}`}
            aria-label={`Rotate to ${orientation === 'portrait' ? 'Landscape' : 'Portrait'}`}
          >
            <RotateCw className="w-4 h-4" />
          </button>

          {/* Reload Iframe */}
          <button
            onClick={handleReload}
            className="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Reload preview screen"
            aria-label="Reload preview screen"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Scale Selector */}
          <div className="hidden md:flex items-center rounded-xl bg-slate-800/80 p-0.5 border border-slate-700/60 text-xs">
            {(['auto', 1, 0.85, 0.75] as const).map((s) => (
              <button
                key={String(s)}
                onClick={() => setScale(s)}
                className={`px-2 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                  scale === s
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {s === 'auto' ? 'Auto Fit' : `${Math.round(s * 100)}%`}
              </button>
            ))}
          </div>

          {/* Exit to Desktop */}
          <button
            onClick={toggleMobileView}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40 text-slate-200 border border-slate-700 text-xs font-semibold transition-all cursor-pointer ml-1"
            title="Close Mobile View (Esc)"
            aria-label="Close mobile preview"
          >
            <X className="w-3.5 h-3.5 text-indigo-400 group-hover:text-rose-400" />
            <span>Close preview</span>
            <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.2 bg-slate-900/80 border border-slate-700 rounded text-[9px] text-slate-400 font-mono">
              ESC
            </kbd>
          </button>
        </div>
      </header>

      {/* Device Viewport Container with smooth scale transform */}
      <div
        className="flex justify-center items-start transition-transform duration-200 origin-top"
        style={{
          transform: `scale(${computedScale})`,
          marginBottom: `calc(${1 - computedScale} * -${activeHeight}px)`,
        }}
      >
        {frameMode === 'hardware' && ['mobile', 'iphone-se', 'pixel'].includes(selectedDevice.id) ? (
          /* Realistic Titanium Flagship Chassis */
          <div
            className="relative bg-slate-950 rounded-[52px] p-[10px] shadow-[0_25px_70px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.12),0_0_0_8px_#1e293b,0_0_0_10px_#090d16] flex flex-col shrink-0 transition-all duration-300"
            style={{
              width: activeWidth + 24,
              height: activeHeight + 24,
            }}
          >
            {/* Top Micro Speaker Grill Slot */}
            <div className="absolute top-[5px] left-1/2 -translate-x-1/2 w-16 h-1 bg-slate-800/80 rounded-full z-50 pointer-events-none" />

            {/* Smartphone Inner Screen Canvas */}
            <div
              className="relative w-full h-full bg-white dark:bg-slate-950 rounded-[44px] overflow-hidden flex flex-col shadow-inner"
              style={{ width: activeWidth, height: activeHeight }}
            >
              {/* Dynamic Island & Status Bar Overlay */}
              <div className="w-full h-11 px-6 flex items-center justify-between text-slate-900 dark:text-slate-100 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shrink-0 border-b border-slate-100 dark:border-slate-800/60 select-none">
                {/* Time */}
                <span className="text-[13px] font-semibold tracking-tight font-sans pl-1">
                  {currentTime || '9:41'}
                </span>

                {/* Sleek Dynamic Island */}
                {selectedDevice.id === 'mobile' && (
                  <div className="w-28 h-7 bg-black rounded-full flex items-center justify-between px-3 shadow-md shadow-black/40 ring-1 ring-white/10">
                    <div className="w-3 h-3 rounded-full bg-slate-950 ring-1 ring-slate-800 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-950/80 ring-1 ring-indigo-500/40" />
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-900/90 ring-1 ring-slate-800 flex items-center justify-center">
                      <div className="w-1 h-1 rounded-full bg-slate-950" />
                    </div>
                  </div>
                )}

                {/* Status Bar Icons (Cellular, WiFi, Battery) */}
                <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                  {/* Cellular 4-bars */}
                  <div className="flex items-end gap-[1.5px] h-2.5 pb-[1px]">
                    <div className="w-[2.5px] h-1 bg-current rounded-xs" />
                    <div className="w-[2.5px] h-1.5 bg-current rounded-xs" />
                    <div className="w-[2.5px] h-2 bg-current rounded-xs" />
                    <div className="w-[2.5px] h-2.5 bg-current rounded-xs" />
                  </div>

                  {/* 5G label */}
                  <span className="text-[9px] font-bold tracking-tight text-slate-500 dark:text-slate-400">
                    5G
                  </span>

                  {/* Wi-Fi 3-arcs SVG */}
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                    <circle cx="12" cy="20" r="1" fill="currentColor" />
                  </svg>

                  {/* Battery Pill */}
                  <div className="w-5 h-2.5 rounded-[4px] border border-current flex items-center p-[1px] relative">
                    <div className="w-3.5 h-full bg-current rounded-[2px]" />
                    <div className="absolute -right-[2.5px] top-1/2 -translate-y-1/2 w-[1.5px] h-1 bg-current rounded-r-xs" />
                  </div>
                </div>
              </div>

              {/* Real 1:1 Responsive Iframe Screen */}
              <div className="flex-1 w-full relative overflow-hidden bg-slate-50 dark:bg-slate-950">
                {renderPreviewFrame('Mobile viewport', activeWidth, activeHeight - 68)}
              </div>

              {/* iOS Home Indicator Bar */}
              <div className="w-full h-6 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md flex items-center justify-center shrink-0 border-t border-slate-100 dark:border-slate-800/40 select-none">
                <div className="w-32 h-1 bg-slate-400/60 dark:bg-slate-600/70 rounded-full" />
              </div>
            </div>
          </div>
        ) : (
          /* Clean Borderless Canvas Viewport */
          <div
            className="relative bg-white dark:bg-slate-950 rounded-2xl shadow-2xl overflow-hidden border border-slate-800 flex flex-col shrink-0"
            style={{ width: activeWidth, height: activeHeight }}
          >
            {renderPreviewFrame('Mobile viewport clean', activeWidth, activeHeight)}
          </div>
        )}
      </div>
    </div>
  )
}