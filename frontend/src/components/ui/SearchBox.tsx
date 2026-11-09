import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { normalizeSearchText } from '../../lib/search'

export type SearchSuggestion = {
  id: number
  text: string
  kind: string
  subtitle: string
  url: string
  match_text?: string
}

type SearchBoxProps = {
  value: string
  onChange: (value: string) => void
  scope: string
  ariaLabel: string
  placeholder: string
  className?: string
  onSelect?: (suggestion: SearchSuggestion) => void
  staticSuggestions?: SearchSuggestion[]
  onFocus?: () => void
  onSubmit?: () => void
  maxLength?: number
}

const RECENT_SEARCH_KEY = 'internsphere_recent_searches'

function accountKey(session: ReturnType<typeof useAuthStore.getState>['session']) {
  return session?.userId != null
    ? `${session.role}:${session.userId}`
    : session?.email
      ? `${session.role}:${session.email.toLocaleLowerCase()}`
      : 'guest'
}

function readRecent(account: string, scope: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '{}') as Record<string, Record<string, string[]>>
    return Array.isArray(stored[account]?.[scope]) ? stored[account][scope].slice(0, 5) : []
  } catch {
    return []
  }
}

function saveRecent(account: string, scope: string, term: string) {
  const cleaned = term.trim()
  if (cleaned.length < 2) return
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '{}') as Record<string, Record<string, string[]>>
    const accountSearches = stored[account] || {}
    const current = accountSearches[scope] || []
    accountSearches[scope] = [cleaned, ...current.filter((item) => normalizeSearchText(item) !== normalizeSearchText(cleaned))].slice(0, 5)
    stored[account] = accountSearches
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(stored))
  } catch (error) {
    console.error('Unable to save recent searches.', error)
  }
}

function HighlightedText({ text, match }: { text: string; match?: string }) {
  if (!match) return <>{text}</>
  const start = normalizeSearchText(text).indexOf(normalizeSearchText(match))
  if (start < 0 || !match.length) return <>{text}</>
  const normalizedText = text.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  const normalizedMatch = match.normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  const normalizedStart = normalizedText.toLocaleLowerCase().indexOf(normalizedMatch.toLocaleLowerCase())
  if (normalizedStart < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, normalizedStart)}
      <mark className="rounded bg-amber-100 text-inherit dark:bg-amber-900/60">
        {text.slice(normalizedStart, normalizedStart + match.length)}
      </mark>
      {text.slice(normalizedStart + match.length)}
    </>
  )
}

export function SearchBox({
  value,
  onChange,
  scope,
  ariaLabel,
  placeholder,
  className = '',
  onSelect,
  staticSuggestions = [],
  onFocus,
  onSubmit,
  maxLength = 100,
}: SearchBoxProps) {
  const session = useAuthStore((state) => state.session)
  const account = accountKey(session)
  const instanceId = useId()
  const listboxId = `search-suggestions-${instanceId}`
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [, setRecentRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retryKey, setRetryKey] = useState(0)
  const term = value.trim()
  const recent = readRecent(account, scope)
  const showLoading = normalizeSearchText(term).length >= 2 && loading
  const showError = normalizeSearchText(term).length >= 2 && error

  const visibleSuggestions = useMemo(() => {
    if (term.length >= 2) return suggestions
    if (recent.length) {
      return recent.map((text, index) => ({
        id: index,
        text,
        kind: 'recent',
        subtitle: 'Recent search',
        url: '',
        match_text: undefined,
      }))
    }
    return staticSuggestions
  }, [recent, staticSuggestions, suggestions, term])

  useEffect(() => {
    if (!open || normalizeSearchText(term).length < 2) {
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setLoading(true)
      setError(false)
      api.get<{ items: SearchSuggestion[] }>('/search/suggest', {
        params: { q: term, scope },
        signal: controller.signal,
      }).then((response) => {
        setSuggestions(Array.isArray(response.data?.items) ? response.data.items : [])
      }).catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Search suggestions request failed.', requestError)
          setSuggestions([])
          setError(true)
        }
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    }, 200)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [open, retryKey, scope, term])

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [])

  const choose = (suggestion: SearchSuggestion) => {
    if (suggestion.kind === 'recent') {
      onChange(suggestion.text)
    } else if (onSelect) {
      onSelect(suggestion)
    } else {
      onChange(suggestion.text)
    }
    if (suggestion.kind !== 'recent') {
      saveRecent(account, scope, term || suggestion.text)
      setRecentRevision((revision) => revision + 1)
    }
    setActiveIndex(-1)
    setOpen(false)
  }

  const clearRecent = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '{}') as Record<string, Record<string, string[]>>
      if (stored[account]) delete stored[account][scope]
      localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(stored))
      setRecentRevision((revision) => revision + 1)
    } catch (storageError) {
      console.error('Unable to clear recent searches.', storageError)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && visibleSuggestions.length) {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % visibleSuggestions.length)
    } else if (event.key === 'ArrowUp' && visibleSuggestions.length) {
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? visibleSuggestions.length - 1 : index - 1))
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0 && visibleSuggestions[activeIndex]) {
        event.preventDefault()
        choose(visibleSuggestions[activeIndex])
      } else {
        saveRecent(account, scope, term)
        setRecentRevision((revision) => revision + 1)
        setOpen(false)
        onSubmit?.()
      }
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={() => { setActiveIndex(-1); setOpen(true); onFocus?.() }}
        onBlur={() => {
          saveRecent(account, scope, term)
          setRecentRevision((revision) => revision + 1)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setActiveIndex(-1)
          setSuggestions([])
          setError(false)
          setLoading(false)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className={`h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${className}`}
      />
      {showLoading ? (
        <Loader2 aria-label="Loading suggestions" className="absolute right-8 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-indigo-500" />
      ) : value ? (
        <button type="button" aria-label="Clear search" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(''); setSuggestions([]); setActiveIndex(-1); setError(false); setLoading(false); inputRef.current?.focus() }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      ) : null}
      {open && (visibleSuggestions.length > 0 || showLoading || showError || normalizeSearchText(term).length >= 2) && (
        <div className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {showLoading ? (
            <p role="status" className="px-3 py-2 text-sm text-slate-500">Loading suggestions…</p>
          ) : showError ? (
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <p role="status" className="text-sm text-rose-600 dark:text-rose-300">Search couldn’t be completed.</p>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setRetryKey((key) => key + 1)} className="rounded px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800">Retry</button>
            </div>
          ) : visibleSuggestions.length === 0 ? (
            <p role="status" className="px-3 py-2 text-sm text-slate-500">No suggestions found. Did you mean to try a shorter or differently spelled search?</p>
          ) : (
            <>
              {term.length < 2 && staticSuggestions.length > 0 && recent.length === 0 && (
                <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Quick links</p>
              )}
              <ul id={listboxId} role="listbox" aria-label={`${ariaLabel} suggestions`}>
                {visibleSuggestions.map((suggestion, index) => (
                  <li key={`${suggestion.kind}-${suggestion.id}-${suggestion.text}`} role="presentation">
                    <button type="button" id={`${listboxId}-${index}`} role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(suggestion)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-indigo-50 aria-selected:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 dark:hover:bg-slate-800 dark:aria-selected:bg-slate-800">
                      <span className="min-w-0">
                        <span className="block truncate font-medium"><HighlightedText text={suggestion.text} match={suggestion.match_text} /></span>
                        <span className="block truncate text-xs text-slate-500">{suggestion.subtitle}</span>
                      </span>
                      <span className="shrink-0 text-[10px] uppercase text-slate-400">{suggestion.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {term.length < 2 && recent.length > 0 && (
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearRecent} className="w-full border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:text-indigo-300 dark:hover:bg-slate-800">
              Clear recent
            </button>
          )}
        </div>
      )}
    </div>
  )
}
