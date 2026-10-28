const reservedGithubHandles = new Set([
  'orgs',
  'settings',
  'login',
  'pricing',
  'features',
  'marketplace',
  'explore',
  'topics',
  'collections',
  'sponsors',
  'customer-stories',
  'security',
  'enterprise',
  'team',
  'about',
])

function parseProfileHandle(input: string, domain: string, pathPattern: RegExp): string | null {
  const value = input.trim()
  if (!value) return null

  let candidate = value
  if (value.startsWith('@')) {
    candidate = value.slice(1)
  } else if (value.includes('/') || value.includes('?') || value.includes('#')) {
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`)
      if (url.hostname.toLowerCase().replace(/^www\./, '') !== domain) return null
      const match = url.pathname.match(pathPattern)
      if (!match) return null
      candidate = match[1]
    } catch {
      return null
    }
  }

  return candidate
}

export function parseGithubHandle(input: string): string | null {
  const handle = parseProfileHandle(input, 'github.com', /^\/([^/]+)(?:\/|$)/)
  if (!handle || handle.length > 39 || !/^[A-Za-z\d]+(?:-[A-Za-z\d]+)*$/.test(handle)) return null
  if (reservedGithubHandles.has(handle.toLowerCase())) return null
  return handle
}

export function parseLeetCodeHandle(input: string): string | null {
  const handle = parseProfileHandle(input, 'leetcode.com', /^\/(?:u\/)?([^/]+)(?:\/|$)/)
  if (!handle || handle.length > 50 || !/^[A-Za-z\d_-]+$/.test(handle)) return null
  return handle
}
