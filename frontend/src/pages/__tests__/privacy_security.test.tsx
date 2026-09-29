import { render, screen, act } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PrivacyPolicyPage } from '../PrivacyPolicyPage'
import { PrivacySecurityPage } from '../PrivacySecurityPage'
import { CookieConsentBanner } from '../../components/ui/CookieConsentBanner'

describe('Privacy, GDPR & CCPA Compliance Suite', () => {
  it('renders the public Privacy Policy page with GDPR and CCPA disclosures', () => {
    render(
      <BrowserRouter>
        <PrivacyPolicyPage />
      </BrowserRouter>
    )

    expect(screen.getByText(/Privacy Policy & Data Protection Statement/i)).toBeTruthy()
    expect(screen.getByText(/General Data Protection Regulation \(GDPR\) & CCPA\/CPRA Compliant/i)).toBeTruthy()
    expect(screen.getByText(/Data Controller & Scope/i)).toBeTruthy()
    expect(screen.getByText(/Legal Bases for Processing \(GDPR Article 6\)/i)).toBeTruthy()
    expect(screen.getByText(/Your Rights \(GDPR & CCPA Portability & Erasure\)/i)).toBeTruthy()
    expect(screen.getByText(/Security & Cryptographic Architecture/i)).toBeTruthy()
  })

  it('renders the Privacy & Data Security Center with data export and erasure options', () => {
    render(
      <BrowserRouter>
        <PrivacySecurityPage />
      </BrowserRouter>
    )

    expect(screen.getByText(/Privacy & Data Security Center/i)).toBeTruthy()
    expect(screen.getByText(/Data Portability & Export/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Export My Data/i })).toBeTruthy()
    expect(screen.getByText(/Consent & Privacy Preferences/i)).toBeTruthy()
    expect(screen.getByText(/Right to Erasure \('Right to be Forgotten'\)/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Delete Account/i })).toBeTruthy()
  })

  it('renders the Cookie Consent Banner with customize and accept controls', () => {
    localStorage.clear()
    render(
      <BrowserRouter>
        <CookieConsentBanner />
      </BrowserRouter>
    )

    act(() => {
      window.dispatchEvent(new Event('open:cookie-preferences'))
    })

    expect(screen.getByText(/Privacy & Consent Center/i)).toBeTruthy()
    expect(screen.getByText(/Strictly Necessary \(Required\)/i)).toBeTruthy()
    expect(screen.getByText(/Performance & Analytics/i)).toBeTruthy()
    expect(screen.getByText(/Do Not Sell or Share My Information \(CCPA\)/i)).toBeTruthy()
  })
})
