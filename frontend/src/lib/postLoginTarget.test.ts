import { describe, expect, it } from 'vitest'
import { getRoleHome, isRouteAllowedForRole, isSameOriginRelativePath, resolvePostLoginTarget } from './postLoginTarget'
import { routes } from './routes'

describe('resolvePostLoginTarget', () => {
  it('rejects external schemes and malformed relative paths', () => {
    expect(isSameOriginRelativePath('//evil.com')).toBe(false)
    expect(isSameOriginRelativePath('https://evil.com')).toBe(false)
    expect(isSameOriginRelativePath('http://evil.com')).toBe(false)
    expect(isSameOriginRelativePath('/\\evil.com')).toBe(false)
    expect(isSameOriginRelativePath('javascript:alert(1)')).toBe(false)
    expect(isSameOriginRelativePath('')).toBe(false)
    expect(isSameOriginRelativePath(null)).toBe(false)
    expect(isSameOriginRelativePath(undefined)).toBe(false)

    expect(resolvePostLoginTarget('STUDENT', '//evil.com')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', 'https://evil.com')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/\\evil.com')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', null)).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', undefined)).toBe(routes.opportunities)
  })

  it('keeps valid same-role paths for student', () => {
    expect(resolvePostLoginTarget('STUDENT', '/opportunities')).toBe('/opportunities')
    expect(resolvePostLoginTarget('STUDENT', '/applications')).toBe('/applications')
    expect(resolvePostLoginTarget('STUDENT', '/applications?status=applied')).toBe('/applications?status=applied')
    expect(resolvePostLoginTarget('STUDENT', '/saved')).toBe('/saved')
    expect(resolvePostLoginTarget('STUDENT', '/profile/student')).toBe('/profile/student')
    expect(resolvePostLoginTarget('STUDENT', '/interviews')).toBe('/interviews')
    expect(resolvePostLoginTarget('STUDENT', '/messages')).toBe('/messages')
    expect(resolvePostLoginTarget('STUDENT', '/notifications')).toBe('/notifications')
  })

  it('falls back to student home when next is a company or admin page', () => {
    expect(isRouteAllowedForRole('STUDENT', '/applications')).toBe(true)
    expect(isRouteAllowedForRole('STUDENT', '/company/jobs')).toBe(false)
    expect(resolvePostLoginTarget('STUDENT', '/company/jobs')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/company')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/company/applicants')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/profile/company')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/admin')).toBe(routes.opportunities)
    expect(resolvePostLoginTarget('STUDENT', '/admin/users')).toBe(routes.opportunities)
  })

  it('keeps valid same-role paths for company', () => {
    expect(resolvePostLoginTarget('COMPANY', '/company/jobs')).toBe('/company/jobs')
    expect(resolvePostLoginTarget('COMPANY', '/company/applicants')).toBe('/company/applicants')
    expect(resolvePostLoginTarget('COMPANY', '/company/pipeline')).toBe('/company/pipeline')
    expect(resolvePostLoginTarget('COMPANY', '/interviews')).toBe('/interviews')
    expect(resolvePostLoginTarget('COMPANY', '/messages')).toBe('/messages')
    expect(resolvePostLoginTarget('COMPANY', '/notifications')).toBe('/notifications')
  })

  it('falls back to company home when next is a student or admin page', () => {
    expect(isRouteAllowedForRole('COMPANY', '/company/jobs')).toBe(true)
    expect(isRouteAllowedForRole('COMPANY', '/applications')).toBe(false)
    expect(resolvePostLoginTarget('COMPANY', '/applications')).toBe(routes.companyJobs())
    expect(resolvePostLoginTarget('COMPANY', '/saved')).toBe(routes.companyJobs())
    expect(resolvePostLoginTarget('COMPANY', '/student/analytics')).toBe(routes.companyJobs())
    expect(resolvePostLoginTarget('COMPANY', '/admin')).toBe(routes.companyJobs())
    expect(resolvePostLoginTarget('COMPANY', '/admin/moderation')).toBe(routes.companyJobs())
  })

  it('keeps valid same-role paths for admin and rejects other roles', () => {
    expect(isRouteAllowedForRole('ADMIN', '/admin/users')).toBe(true)
    expect(isRouteAllowedForRole('ADMIN', '/company/jobs')).toBe(false)
    expect(resolvePostLoginTarget('ADMIN', '/admin')).toBe('/admin')
    expect(resolvePostLoginTarget('ADMIN', '/admin/users')).toBe('/admin/users')
    expect(resolvePostLoginTarget('ADMIN', '/admin/moderation')).toBe('/admin/moderation')
    expect(resolvePostLoginTarget('ADMIN', '/notifications')).toBe('/notifications')

    expect(resolvePostLoginTarget('ADMIN', '/company/jobs')).toBe(routes.admin)
    expect(resolvePostLoginTarget('ADMIN', '/applications')).toBe(routes.admin)
    expect(resolvePostLoginTarget('ADMIN', '/messages')).toBe(routes.admin)
  })

  it('resolves default role homes correctly', () => {
    expect(getRoleHome('ADMIN')).toBe(routes.admin)
    expect(getRoleHome('COMPANY')).toBe(routes.companyJobs())
    expect(getRoleHome('STUDENT')).toBe(routes.opportunities)
    expect(getRoleHome(null)).toBe(routes.opportunities)
  })
})
