import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { Pencil } from 'lucide-react'
import { DataList } from './DataList'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('exposes an accessible name and disabled loading state', () => {
    render(<IconButton icon={Pencil} aria-label="Edit item" isLoading onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Edit item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit item' })).toHaveAttribute('title', 'Edit item')
  })
})

describe('DataList', () => {
  const columns = [{ key: 'name', header: 'Name', render: (row: { name: string }) => row.name }]

  it('renders responsive list content and an empty state', () => {
    const { rerender } = render(
      <DataList ariaLabel="Questions" rows={[{ id: 1, name: 'Question one' }]} columns={columns} getRowKey={(row) => row.id} />,
    )
    expect(screen.getByRole('table', { name: 'Questions' })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Questions' })).getByText('Question one')).toBeInTheDocument()

    rerender(<DataList ariaLabel="Questions" rows={[]} columns={columns} getRowKey={(row) => row.name} emptyState="No questions." />)
    expect(screen.getByText('No questions.')).toBeInTheDocument()
  })

  it('renders skeleton rows while loading an empty list', () => {
    render(<DataList ariaLabel="Tests" rows={[]} columns={columns} getRowKey={(row) => row.name} loading skeletonRows={2} />)
    expect(screen.getByRole('status', { name: 'Loading Tests' })).toBeInTheDocument()
  })
})
