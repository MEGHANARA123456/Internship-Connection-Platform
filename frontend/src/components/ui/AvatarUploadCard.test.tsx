import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { AvatarUploadCard } from './AvatarUploadCard'

vi.mock('../../api/client', () => ({
  api: { post: vi.fn(), delete: vi.fn() },
  getFullMediaUrl: (url: string | null) => url,
}))

describe('AvatarUploadCard', () => {
  it.each([
    [null, 'Upload Photo'],
    ['https://example.com/avatar.png', 'Change Photo'],
  ])('shows one upload control for avatar %s', (avatarUrl, label) => {
    render(<AvatarUploadCard currentAvatarUrl={avatarUrl} name="Test User" roleLabel="Student" />)

    expect(screen.getAllByRole('button', { name: label })).toHaveLength(1)
    expect(screen.queryByTitle('Change Profile Photo')).not.toBeInTheDocument()
    if (avatarUrl) expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })
})
