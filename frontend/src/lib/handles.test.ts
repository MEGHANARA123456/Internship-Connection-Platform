import { describe, expect, it } from 'vitest'
import { parseGithubHandle, parseLeetCodeHandle } from './handles'

describe('parseGithubHandle', () => {
  it.each([
    ['username', 'username'],
    ['@username', 'username'],
    ['github.com/username', 'username'],
    ['https://github.com/username/', 'username'],
    ['https://www.github.com/username?tab=repositories', 'username'],
    ['https://github.com/username/repository', 'username'],
  ])('normalizes %s', (input, expected) => {
    expect(parseGithubHandle(input)).toBe(expected)
  })

  it.each(['', 'invalid username', '-username', 'username-', 'user--name', 'a'.repeat(40), 'orgs', 'settings', 'login', 'pricing', 'https://example.com/username'])(
    'rejects %s',
    (input) => expect(parseGithubHandle(input)).toBeNull(),
  )
})

describe('parseLeetCodeHandle', () => {
  it.each([
    ['username', 'username'],
    ['@username', 'username'],
    ['leetcode.com/u/username', 'username'],
    ['https://www.leetcode.com/u/username/', 'username'],
    ['https://leetcode.com/username?tab=solutions', 'username'],
  ])('normalizes %s', (input, expected) => {
    expect(parseLeetCodeHandle(input)).toBe(expected)
  })

  it.each(['', 'invalid username', 'user/name', 'https://example.com/username'])(
    'rejects %s',
    (input) => expect(parseLeetCodeHandle(input)).toBeNull(),
  )
})
