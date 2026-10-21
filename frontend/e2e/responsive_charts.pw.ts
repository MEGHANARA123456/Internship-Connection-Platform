import { expect, test, type Page } from '@playwright/test'

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 },
]
const themes = ['light', 'dark'] as const
const chartFocuses = ['All charts', 'Funnel', 'Trends', 'Status', 'Domains', 'Interviews', 'Insights']

const chartRows = (names: string[]) => names.map((name, index) => ({ name, count: 12 - index }))

async function prepareAdminCharts(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((selectedTheme) => {
    sessionStorage.setItem('session', JSON.stringify({
      accessToken: 'responsive-qa-token',
      refreshToken: '',
      role: 'ADMIN',
      userId: 991,
      email: 'responsive-qa@example.test',
    }))
    localStorage.setItem('theme', selectedTheme)
    document.documentElement.classList.toggle('dark', selectedTheme === 'dark')
  }, theme)

  await page.route('**/admin/insights?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'admin',
        range: '30',
        sample_size: 42,
        has_data: true,
        period_label: 'last 30 days',
        funnel: [{ stage: 'Applications', count: 12, conversion_pct: 100, dropoff_pct: 0 }],
        activity_trend: [{ date: '2026-10-01', applications: 12, interviews: 4, offers: 2 }],
        status_breakdown: [{ status: 'Published', count: 12 }],
        domains: [{ name: 'AI & Machine Learning', count: 12 }],
        work_modes: [{ name: 'Remote', count: 12 }],
        chart_samples: {
          signups_over_time: 42,
          admin_applications_over_time: 42,
          admin_actions_by_type: 42,
          verification_status: 42,
          domains: 42,
        },
        charts: {
          signups_over_time: chartRows(['Students', 'Companies']),
          admin_applications_over_time: chartRows(['Applications']),
          internships_by_status: chartRows(['Published', 'Draft', 'Pending approval']),
          admin_actions_by_type: chartRows([
            'User_reinstated', 'Posting_approved', 'Gdpr_data_export',
            'User_suspended', 'Posting_rejected', 'Company_verified', 'Company_rejected',
          ]),
          verification_status: chartRows(['Verified', 'Pending', 'Rejected']),
          domains: chartRows(['AI & Machine Learning', 'Software Development', 'Data & Analytics']),
        },
        kpis: {},
      }),
    })
  })

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Platform Analytics' })).toBeVisible()
  await expect(page.locator('[data-chart-panel]').first()).toBeVisible()
}

for (const viewport of viewports) {
  for (const theme of themes) {
    test(`admin charts fit ${viewport.width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await prepareAdminCharts(page, theme)

      for (const focus of chartFocuses) {
        await page.getByRole('button', { name: /Show:/ }).click()
        await page.getByRole('menuitemradio', { name: focus, exact: true }).click()
        await expect.poll(async () => page.locator('[data-chart-panel]').count()).toBeGreaterThan(0)

        const layout = await page.locator('[data-chart-panel]').evaluateAll((elements) => {
          const panels = elements.filter((element) => !element.parentElement?.closest('[data-chart-panel]'))
          const boxes = panels.map((panel) => {
            const rect = panel.getBoundingClientRect()
            const legend = panel.querySelector('[aria-label="Chart legend"]')
            const legendRect = legend?.getBoundingClientRect()
            return {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              legendInside: !legendRect || (
                legendRect.left >= rect.left - 1
                && legendRect.right <= rect.right + 1
                && legendRect.top >= rect.top - 1
                && legendRect.bottom <= rect.bottom + 1
              ),
            }
          })
          const overflow = Array.from(document.querySelectorAll<HTMLElement>('body *'))
            .filter((element) => !['SVG', 'PATH', 'LINE', 'CIRCLE', 'RECT', 'POLYGON', 'POLYLINE', 'G'].includes(element.tagName))
            .some((element) => {
              const style = getComputedStyle(element)
              if (style.display === 'none' || style.visibility === 'hidden') return false
              return element.scrollWidth > element.clientWidth + 2
                || element.getBoundingClientRect().left < -1
                || element.getBoundingClientRect().right > window.innerWidth + 1
            })
          let intersects = false
          for (let first = 0; first < boxes.length; first += 1) {
            for (let second = first + 1; second < boxes.length; second += 1) {
              const a = boxes[first]
              const b = boxes[second]
              if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) intersects = true
            }
          }
          return { boxes, overflow, intersects }
        })

        expect(layout.boxes.length, `no chart panels for ${focus}`).toBeGreaterThan(0)
        expect(layout.intersects, `chart panels overlap for ${focus}`).toBe(false)
        expect(layout.boxes.every((box) => box.legendInside), `legend escapes its panel for ${focus}`).toBe(true)
        expect(layout.overflow, `text or layout overflows for ${focus}`).toBe(false)
      }
    })
  }
}
