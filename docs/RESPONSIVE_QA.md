# Responsive QA

## Analytics chart layout

The Playwright spec at `frontend/e2e/responsive_charts.pw.ts` exercises the admin analytics
dashboard at 375, 768, 1280, and 1920 CSS pixels in both light and dark themes. It checks the
"All charts" view and each available chart focus for panel intersections, legend containment, and
horizontal text/layout overflow.

The frontend project does not currently include Playwright or `@playwright/test` as a dependency,
so this spec has not been executed in this environment. After adding the project's preferred
Playwright setup and starting the frontend with a matching backend/API, run it with
`npx playwright test --test-match="**/*.pw.ts"`. Do not treat a unit-test or build pass as a
substitute for browser responsive QA.

## Manual screenshot checklist

Capture the admin charts, verification resend page, applicant actions menu, and both Upcoming and
Cancelled interview tabs at 375, 768, and 1280 CSS pixels in light and dark themes. Include the
viewport and theme in each screenshot filename, and verify the full chart legend and menu contents
are visible before capture.
