const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

export const INR_CURRENCY_SYMBOL = inrFormatter
  .formatToParts(0)
  .find((part) => part.type === 'currency')?.value ?? 'INR'

export function formatINR(amount: number): string {
  return inrFormatter.format(amount)
}

export function formatINRBucket(bucket: string): string {
  const range = bucket.match(/^(\d+)-(\d+)$/)
  if (range) return `${formatINR(Number(range[1]))}–${formatINR(Number(range[2]))}`

  const minimum = bucket.match(/^(\d+)\+$/)
  return minimum ? `${formatINR(Number(minimum[1]))}+` : bucket
}
