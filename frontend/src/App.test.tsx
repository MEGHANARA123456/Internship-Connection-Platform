import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { LoginPage } from './pages/AuthPages'

describe('platform shell', () => {
  it('renders the recruitment landing shell with InternSphere branding', () => {
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(screen.getAllByText('Intern').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sphere').length).toBeGreaterThan(0)
    expect(screen.getByText('Browse Internships')).toBeTruthy()
  })

  it('renders the login form', () => {
    render(<BrowserRouter><LoginPage /></BrowserRouter>)
    expect(screen.getByText(/Sign In to/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeTruthy()
  })
})
