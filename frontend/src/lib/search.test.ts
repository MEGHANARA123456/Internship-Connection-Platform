import { describe, expect, it } from 'vitest'
import { normalizeSearchText, searchTextMatches } from './search'

describe('search text normalization', () => {
  it.each([
    [undefined, ''],
    [null, ''],
    [42, '42'],
    [['  Python ', 'RÉACT '], 'python react'],
    ['  Crème Brûlée  ', 'creme brulee'],
    [{}, 'object object'],
  ])('normalizes %s safely', (value, expected) => {
    expect(normalizeSearchText(value)).toBe(expected)
  })

  it('handles objects that cannot be converted to strings', () => {
    const invalidObject = {
      [Symbol.toPrimitive]() {
        throw new Error('Cannot convert value')
      },
    }

    expect(normalizeSearchText(invalidObject)).toBe('')
    expect(() => searchTextMatches(null, [undefined, null, ['Python', {}], invalidObject])).not.toThrow()
    expect(searchTextMatches('python', [undefined, null, ['Python', {}], invalidObject])).toBe(true)
  })

  it('preserves partial, case-insensitive, accent-insensitive matching', () => {
    expect(searchTextMatches('creme', ['Crème Brûlée'])).toBe(true)
    expect(searchTextMatches('BRU', ['Crème Brûlée'])).toBe(true)
  })
})
