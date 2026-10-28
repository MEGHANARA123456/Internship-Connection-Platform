import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { isKnownInternalRoute } from './safeRoutes'

function inlineParts(text: string, keyPrefix: string) {
  const pattern = /(\*\*[^*]+\*\*|\[([^\]]+)\]\((\/[^)\s]*)\))/g
  const parts = []
  let cursor = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    const key = `${keyPrefix}-${index++}`
    if (match[0].startsWith('**')) {
      parts.push(<strong key={key}>{match[0].slice(2, -2)}</strong>)
    } else {
      const label = match[2]
      const route = match[3]
      parts.push(isKnownInternalRoute(route)
        ? <Link key={key} to={route} className="font-semibold text-indigo-600 underline underline-offset-2 dark:text-indigo-300">{label}</Link>
        : label)
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.map((part, index) => <Fragment key={`${keyPrefix}-part-${index}`}>{part}</Fragment>)
}

export function SafeText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  return (
    <div className="space-y-1 break-words text-sm leading-relaxed">
      {lines.map((line, index) => {
        const bullet = /^\s*[-*]\s+/.exec(line)
        if (bullet) {
          return <div key={`line-${index}`} className="flex gap-2 pl-1"><span aria-hidden="true">•</span><span>{inlineParts(line.slice(bullet[0].length), `line-${index}`)}</span></div>
        }
        return line
          ? <p key={`line-${index}`}>{inlineParts(line, `line-${index}`)}</p>
          : <div key={`line-${index}`} className="h-1" aria-hidden="true" />
      })}
    </div>
  )
}
