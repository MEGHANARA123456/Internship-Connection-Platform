const CHART_PALETTE = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#8172B2',
  '#117733',
  '#AA4499',
  '#6699CC',
  '#9E5900',
  '#3A7A5B',
  '#A04F62',
  '#6B6B00',
] as const

const SEMANTIC_STATUS_COLORS: Record<string, string> = {
  PUBLISHED: '#16a34a',
  DRAFT: '#64748b',
  PENDING_APPROVAL: '#d97706',
  PENDING: '#d97706',
  REJECTED: '#dc2626',
  CLOSED: '#6366f1',
  VERIFIED: '#16a34a',
  APPLIED: '#2563eb',
  UNDER_REVIEW: '#d97706',
  SHORTLISTED: '#7c3aed',
  INTERVIEW: '#0891b2',
  INTERVIEW_SCHEDULED: '#0891b2',
  SELECTED: '#059669',
  ACCEPTED: '#047857',
  WITHDRAWN: '#64748b',
  CANCELLED: '#64748b',
  COMPLETED: '#059669',
  SCHEDULED: '#0891b2',
}

const FIXED_COLORS: Record<string, string> = {
  ...SEMANTIC_STATUS_COLORS,
  REMOTE: '#0072B2',
  ONSITE: '#E69F00',
  HYBRID: '#009E73',
  APPLICATION: '#4f46e5',
  APPLICATIONS: '#4f46e5',
  APPLICATIONS_FILED: '#4f46e5',
  APPLICATIONS_SUBMITTED: '#4f46e5',
  APPLICATIONS_RECEIVED: '#4f46e5',
  STUDENTS: '#4f46e5',
  INTERVIEWS: '#0891b2',
  INTERVIEW_STAGE_APPLICATIONS: '#0891b2',
  COMPANIES: '#059669',
  OFFERS: '#7c3aed',
  FINAL_OFFERS_ACCEPTED: '#7c3aed',
  MISSING: '#db2777',
  MEDIAN: '#d97706',
}

function normalizeKey(key: string): string {
  return key.trim().replace(/\s+/g, '_').toUpperCase()
}

function colorFromHue(index: number): string {
  const hue = (index * 137.508) % 360
  const saturation = 68
  let best = `hsl(${hue} ${saturation}% 40%)`
  let bestDistance = Number.POSITIVE_INFINITY

  for (let lightness = 15; lightness <= 65; lightness += 1) {
    const color = `hsl(${hue} ${saturation}% ${lightness}%)`
    const [red, green, blue] = hslToRgb(hue, saturation, lightness).map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    const distance = Math.abs(luminance - 0.2)
    if (luminance >= 0.13 && luminance <= 0.29 && distance < bestDistance) {
      best = color
      bestDistance = distance
    }
  }
  return best
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const section = hue / 60
  const secondary = chroma * (1 - Math.abs(section % 2 - 1))
  const rgb = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary]
  const offset = l - chroma / 2
  return rgb.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number]
}

export function assignColors(keys: string[]): Record<string, string> {
  const normalizedKeys = [...new Set(keys.map(normalizeKey).filter(Boolean))].sort()
  const colorsByNormalizedKey: Record<string, string> = {}
  const usedColors = new Set<string>()
  const reservedFixedColors = new Set(Object.values(FIXED_COLORS).map((color) => color.toLowerCase()))
  const workModeKeys = normalizedKeys.filter((key) => ['REMOTE', 'ONSITE', 'HYBRID'].includes(key))
  const otherFixedKeys = normalizedKeys.filter((key) => FIXED_COLORS[key] && !workModeKeys.includes(key))

  for (const key of [...workModeKeys, ...otherFixedKeys]) {
    const color = FIXED_COLORS[key]
    if (!usedColors.has(color.toLowerCase())) {
      colorsByNormalizedKey[key] = color
      usedColors.add(color.toLowerCase())
    }
  }

  const unknownKeys = normalizedKeys.filter((key) => !colorsByNormalizedKey[key])
  for (const key of unknownKeys) {
    let hash = 0
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    const startIndex = hash % CHART_PALETTE.length
    let color: string | undefined
    for (let offset = 0; offset < CHART_PALETTE.length; offset += 1) {
      const candidate = CHART_PALETTE[(startIndex + offset) % CHART_PALETTE.length]
      if (!usedColors.has(candidate.toLowerCase()) && !reservedFixedColors.has(candidate.toLowerCase())) {
        color = candidate
        break
      }
    }
    if (!color) {
      let generatedIndex = hash
      color = colorFromHue(generatedIndex++)
      while (usedColors.has(color.toLowerCase())) color = colorFromHue(generatedIndex++)
    }
    colorsByNormalizedKey[key] = color
    usedColors.add(color.toLowerCase())
  }

  return Object.fromEntries(keys.map((key) => [
    key,
    colorsByNormalizedKey[normalizeKey(key)] ?? colorFromHue(key.length),
  ]))
}

export function chartColorFor(key: string): string {
  return assignColors([key])[key]
}
