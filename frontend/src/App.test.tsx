import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { LoginPage } from './pages/AuthPages'

describe('platform shell', () => {
  it('renders the recruitment landing shell', () => {
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(screen.getByText('InternshipHub')).toBeTruthy()
    expect(screen.getByText('Browse Internships')).toBeTruthy()
  })

  it('renders the login form', () => {
    render(<BrowserRouter><LoginPage /></BrowserRouter>)
    expect(screen.getByText('Welcome back')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })
})
