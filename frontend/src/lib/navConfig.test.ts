import { describe, expect, it } from 'vitest'
import { applicationStatusMenuItems, navigationConfig, type NavigationRole } from './navConfig'

describe('navigation configuration', () => {
  it.each(['STUDENT', 'COMPANY', 'ADMIN', 'GUEST'] as NavigationRole[])(
    '%s keeps destinations and labels unique across top bar and hamburger menus',
    (role) => {
      const items = [...navigationConfig[role].topBar, ...navigationConfig[role].hamburger]
      const labels = items.map((item) => item.label)
      const routes = items.flatMap((item) => item.route ? [item.route] : [])

      expect(new Set(labels).size).toBe(labels.length)
      expect(new Set(routes).size).toBe(routes.length)
      expect(items.every((item) => item.id && item.label && item.icon)).toBe(true)
    },
  )

  it('keeps the application status sub-list at distinct deep-link URLs outside duplicate top-level destinations', () => {
    const statusRoutes = applicationStatusMenuItems.map((item) =>
      item.query ? `/applications?status=${item.query}` : '/applications',
    )
    const topLevelRoutes = navigationConfig.STUDENT.topBar
      .concat(navigationConfig.STUDENT.hamburger)
      .flatMap((item) => item.route ? [item.route] : [])

    expect(new Set(statusRoutes).size).toBe(statusRoutes.length)
    expect(statusRoutes.some((route) => topLevelRoutes.includes(route))).toBe(false)
  })
})
