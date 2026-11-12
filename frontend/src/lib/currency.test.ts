import { describe, expect, it } from 'vitest'
import { formatINR, formatINRBucket, INR_CURRENCY_SYMBOL } from './currency'

describe('INR formatting', () => {
  it('formats rupees in Indian number grouping without fractional digits', () => {
    expect(formatINR(15000)).toBe('₹15,000')
    expect(formatINR(1527.27)).toBe('₹1,527')
    expect(INR_CURRENCY_SYMBOL).toBe('₹')
  })

  it('formats numeric stipend buckets using the shared currency formatter', () => {
    expect(formatINRBucket('1-10000')).toBe('₹1–₹10,000')
    expect(formatINRBucket('10001-25000')).toBe('₹10,001–₹25,000')
    expect(formatINRBucket('25001+')).toBe('₹25,001+')
    expect(formatINRBucket('Unpaid')).toBe('Unpaid')
  })
})
