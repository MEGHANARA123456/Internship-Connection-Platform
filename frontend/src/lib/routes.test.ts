import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { navigationConfig, type NavigationRole } from './navConfig'
import { routeTable, routes } from './routes'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx|ts)$/.test(name) && !/\.test\.(tsx|ts)$/.test(name) ? [path] : []
  })
}

function routeMatches(pathname: string, registeredPath: string): boolean {
  if (pathname === registeredPath) return true
  const expression = registeredPath
    .split('/')
    .map((segment) => segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('/')
  return new RegExp(`^${expression}/?$`).test(pathname)
}

describe('typed route contract', () => {
  it('provides a shared, query-aware interview destination', () => {
    expect(routes.interviews({ tab: 'upcoming', highlight: 42 }))
      .toBe('/interviews?tab=upcoming&highlight=42')
  })

  it('maps every role navigation entry to a registered route', () => {
    const registeredPaths = routeTable.map(([, path]) => path.split('?')[0])
    for (const role of Object.keys(navigationConfig) as NavigationRole[]) {
      const entries = [...navigationConfig[role].topBar, ...navigationConfig[role].hamburger]
      for (const entry of entries) {
        if (!entry.route) continue
        const pathname = new URL(entry.route, 'http://intersphere.test').pathname
        expect(
          registeredPaths.some((registeredPath) => routeMatches(pathname, registeredPath)),
          `${role} navigation item "${entry.label}" should resolve to a registered route`,
        ).toBe(true)
      }
    }
  })

  it('keeps all route table destinations non-empty and explicit', () => {
    expect(routeTable.length).toBeGreaterThan(30)
    for (const [name, path] of routeTable) {
      expect(path, `${name} should have a path`).toBeTruthy()
      expect(path.startsWith('/')).toBe(true)
    }
  })

  it('does not use literal internal Link, NavLink, navigate, or location targets', () => {
    const directTargets = [
      /<(?:Link|NavLink)\b[\s\S]{0,400}?\bto\s*=\s*["']\/[^"']*["']/,
      /\bnavigate\s*\(\s*['"`]\//,
      /window\.location\.href\s*=\s*['"`]\//,
    ]
    const matches = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return directTargets.some((pattern) => pattern.test(source)) ? [path] : []
    })
    expect(matches).toEqual([])
  })
})
