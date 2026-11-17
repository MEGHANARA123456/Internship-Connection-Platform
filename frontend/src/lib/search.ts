export function normalizeSearchText(value: unknown): string {
  let text: string
  try {
    text = String(value ?? '').trim()
  } catch {
    return ''
  }
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

function searchableValues(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) return value.flatMap(searchableValues)
  return []
}

export function searchTextMatches(query: unknown, values: readonly unknown[]): boolean {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const words = values
    .flatMap(searchableValues)
    .flatMap((value) => normalizeSearchText(value).split(' '))
  return terms.every((term) => words.some((word) => (
    word === term
    || word.startsWith(term)
    || word.includes(term)
    || (Math.max(term.length, word.length) >= 3
      && 1 - levenshteinDistance(term, word) / Math.max(term.length, word.length) >= 0.6)
  )))
}

export function stripMarkdownPreview(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[`*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
