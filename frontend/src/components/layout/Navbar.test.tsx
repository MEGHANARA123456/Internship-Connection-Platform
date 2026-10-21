import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { Navbar } from './Navbar'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('../../lib/useWebSocketChat', () => ({ useWebSocketChat: vi.fn() }))
vi.mock('./BottomTabBar', () => ({ BottomTabBar: () => null }))

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('Navbar menus', () => {
  it('removes the slash hint and does not open search when slash is typed in a form field', () => {
    render(
      <MemoryRouter>
        <Navbar />
        <input aria-label="Text input" />
        <textarea aria-label="Text area" />
      </MemoryRouter>,
    )
    expect(document.querySelector('kbd')).toBeNull()
    fireEvent.keyDown(screen.getByLabelText('Text input'), { key: '/' })
    fireEvent.keyDown(screen.getByLabelText('Text area'), { key: '/' })
    expect(screen.queryByText('Quick links')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Search InternSphere' })).not.toBeInTheDocument()
  })

  it('renders the student destinations once across the desktop menus', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'token',
      refreshToken: 'refresh',
      userId: 1,
      role: 'STUDENT',
      email: 'student@example.com',
    })
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/navigation/counts') {
        return {
          data: {
            unread_notifications: 0,
            invites_new: 2,
            application_updates: 3,
            saved: 1,
          },
        } as never
      }
      return { data: [] } as never
    })
    render(<MemoryRouter><Navbar /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /Internships/ }))
    const internshipMenu = screen.getByRole('menu', { name: 'Internships' })
    fireEvent.click(within(internshipMenu).getByRole('menuitem', { name: /Application status/ }))

    const internshipItems = within(internshipMenu).getAllByRole('menuitem')
    const hamburgerButton = screen.getByRole('button', { name: 'Open navigation menu' })
    fireEvent.click(hamburgerButton)
    const hamburgerMenu = screen.getByRole('menu', { name: 'Navigation' })
    const hamburgerItems = within(hamburgerMenu).getAllByRole('menuitem').filter((item) =>
      !item.closest('[class*="md:hidden"]'),
    )

    const desktopItems = [...internshipItems, ...hamburgerItems]
    const labels = desktopItems.map((item) => {
      const label = Array.from(item.children).find((child) => child.tagName === 'SPAN' && child.className.includes('flex-1'))
      return label?.textContent?.replace(/\s+/g, ' ').trim() || item.textContent?.replace(/\s+/g, ' ').trim()
    }).filter(Boolean)
    expect(new Set(labels).size).toBe(labels.length)
    const routes = desktopItems.flatMap((item) => item instanceof HTMLAnchorElement ? [item.getAttribute('href')] : [])
    expect(new Set(routes).size).toBe(routes.length)
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
    expect(within(internshipMenu).getByText('2 New')).toBeInTheDocument()
    expect(within(internshipMenu).getByText('3')).toBeInTheDocument()
  })

  it('opens search with Ctrl+K and navigates its quick links with the keyboard', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'token', refreshToken: 'refresh', userId: 2, role: 'STUDENT', email: 'student@example.com',
    })
    render(
      <MemoryRouter>
        <Navbar />
        <Routes><Route path="/saved" element={<div>Saved destination</div>} /></Routes>
      </MemoryRouter>,
    )
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const combo = await screen.findByRole('combobox', { name: 'Search InternSphere' })
    expect(screen.getByText('Quick links')).toBeInTheDocument()
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    fireEvent.keyDown(combo, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Saved/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(combo, { key: 'Enter' })
    expect(await screen.findByText('Saved destination')).toBeInTheDocument()
  })

  it('shows a search error and retries without closing the other navigation UI', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'token', refreshToken: 'refresh', userId: 3, role: 'ADMIN', email: 'admin@example.com',
    })
    let searches = 0
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/search') {
        searches += 1
        if (searches === 1) throw new Error('offline')
        return { data: { groups: [{ type: 'audit_logs', label: 'Audit logs', items: [{ id: 7, title: 'Audit event', subtitle: 'admin', badge: 'Audit log', url: '/admin/audit-logs' }] }] } } as never
      }
      return { data: {} } as never
    })
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const combo = await screen.findByRole('combobox', { name: 'Search InternSphere' })
    fireEvent.change(combo, { target: { value: 'audit' } })
    expect(await screen.findByText('Search couldn’t be completed.', {}, { timeout: 1500 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Audit event', {}, { timeout: 1500 })).toBeInTheDocument()
  })
})
