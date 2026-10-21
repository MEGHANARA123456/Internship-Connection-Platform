import type { AnchorHTMLAttributes, MouseEvent } from 'react'

type GmailActionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> & {
  href: string
}

function openMobileGmail(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const userAgent = navigator.userAgent
  const android = /Android/i.test(userAgent)
  const ios = /iPhone|iPad|iPod/i.test(userAgent)
  if (!android && !ios) return

  event.preventDefault()
  const fallback = window.open('about:blank', '_blank')
  if (fallback) fallback.opener = null

  if (android) {
    const intentUrl = href.replace(/^https:\/\//, 'intent://')
      + `#Intent;scheme=https;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(href)};end`
    window.location.href = intentUrl
  } else {
    window.location.href = 'googlegmail://'
  }

  window.setTimeout(() => {
    if (fallback && !fallback.closed) fallback.location.replace(href)
    else window.location.href = href
  }, 1500)
}

export function GmailActionLink({ href, onClick, ...props }: GmailActionLinkProps) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        openMobileGmail(event, href)
        onClick?.(event)
      }}
    />
  )
}
