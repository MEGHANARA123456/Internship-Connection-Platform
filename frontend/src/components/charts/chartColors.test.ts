import { describe, expect, it } from 'vitest'
import { assignColors, chartColorFor } from './chartColors'

describe('assignColors', () => {
  it.each([1, 5, 12, 30])('assigns distinct colors for %i chart keys', (count) => {
    const keys = Array.from({ length: count }, (_, index) => `Category ${index + 1}`)
    const colors = assignColors(keys)

    expect(new Set(Object.values(colors)).size).toBe(count)
  })

  it('assigns fixed work-mode colors case-insensitively and ignores surrounding spaces', () => {
    expect(assignColors(['Remote', ' Onsite ', 'HYBRID', 'remote', 'onsite', 'Hybrid'])).toEqual({
      Remote: '#0072B2',
      ' Onsite ': '#E69F00',
      HYBRID: '#009E73',
      remote: '#0072B2',
      onsite: '#E69F00',
      Hybrid: '#009E73',
    })
  })

  it('preserves the fixed application-status colors', () => {
    expect(chartColorFor('Applied')).toBe('#2563eb')
    expect(chartColorFor('Under review')).toBe('#d97706')
    expect(chartColorFor('Shortlisted')).toBe('#7c3aed')
    expect(chartColorFor('Rejected')).toBe('#dc2626')
  })

  it('keeps unknown-key colors stable for the same key', () => {
    expect(assignColors(['Remote', 'Custom category'])['Custom category'])
      .toBe(assignColors(['Custom category'])['Custom category'])
  })
})
