import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useViewModeStore } from '../../store/viewMode'
import { MobileViewSimulator } from './MobileViewSimulator'

function renderSimulator() {
  return render(
    <MemoryRouter initialEntries={['/company/jobs?tab=active']}>
      <MobileViewSimulator><div>Current page</div></MobileViewSimulator>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  window.history.replaceState({}, '', '/company/jobs?tab=active')
  window.sessionStorage.clear()
  useViewModeStore.getState().setMobileView(true)
})

afterEach(() => {
  useViewModeStore.getState().setMobileView(false)
  window.history.replaceState({}, '', '/')
})

describe('MobileViewSimulator', () => {
  it('embeds the current page in a same-origin iframe and shows a loader until it loads', () => {
    renderSimulator()
    const iframe = screen.getByTitle('Mobile viewport')
    const src = new URL(iframe.getAttribute('src')!, window.location.origin)

    expect(src.origin).toBe(window.location.origin)
    expect(src.pathname).toBe('/company/jobs')
    expect(src.searchParams.get('tab')).toBe('active')
    expect(src.searchParams.get('preview')).toBe('1')
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview')

    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: null })
    fireEvent.load(iframe)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Preview couldn’t be displayed')
  })

  it('offers the requested presets and preserves the selected preset for this tab session', () => {
    const { unmount } = renderSimulator()
    fireEvent.click(screen.getByRole('button', { name: /Mobile 390/ }))
    const presets = screen.getByText('Select Device Frame').parentElement!
    fireEvent.click(within(presets).getByRole('button', { name: /iPhone SE/ }))
    expect(screen.getByRole('button', { name: /iPhone SE 375 × 667/ })).toBeInTheDocument()
    expect(window.sessionStorage.getItem('screen-preview-size')).toBe('iphone-se')

    fireEvent.click(screen.getByRole('button', { name: /iPhone SE 375/ }))
    const reopenedPresets = screen.getByText('Select Device Frame').parentElement!
    expect(within(reopenedPresets).getByRole('button', { name: /Pixel/ })).toHaveTextContent('412 × 915')
    expect(within(reopenedPresets).getByRole('button', { name: /Tablet/ })).toHaveTextContent('768 × 1024')
    unmount()

    renderSimulator()
    expect(screen.getByRole('button', { name: /iPhone SE 375 × 667/ })).toBeInTheDocument()
  })

  it('keeps the close, rotate, reload, and Escape controls available', () => {
    renderSimulator()
    expect(screen.getByRole('button', { name: 'Close mobile preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate to Landscape' })).toBeInTheDocument()

    const originalFrame = screen.getByTitle('Mobile viewport')
    fireEvent.click(screen.getByRole('button', { name: 'Reload preview screen' }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByTitle('Mobile viewport')).not.toBe(originalFrame)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useViewModeStore.getState().isMobileView).toBe(false)
  })
})
