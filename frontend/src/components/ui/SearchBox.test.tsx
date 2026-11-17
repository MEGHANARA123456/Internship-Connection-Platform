import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { SearchBox, type SearchSuggestion } from './SearchBox'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}))

const suggestions: SearchSuggestion[] = [
  { id: 1, text: 'Business Development Associate', kind: 'internship', subtitle: 'Company', url: '/opportunities/1' },
  { id: 2, text: 'Python', kind: 'skill', subtitle: 'Internship', url: '/opportunities/2' },
]

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('SearchBox', () => {
  it('supports arrow-key navigation and selecting a suggestion with Enter', () => {
    const onSelect = vi.fn()
    render(
      <SearchBox
        ariaLabel="Search internships"
        value=""
        onChange={vi.fn()}
        onSelect={onSelect}
        staticSuggestions={suggestions}
        scope="internships"
        placeholder="Search internships"
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Search internships' })
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    const firstOption = screen.getByRole('option', { name: /Business Development Associate/ })
    expect(firstOption).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', firstOption.id)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(suggestions[0])
  })

  it('uses unique listbox ids when desktop and mobile search boxes coexist', () => {
    render(
      <>
        <SearchBox ariaLabel="Desktop search" value="" onChange={vi.fn()} staticSuggestions={suggestions} scope="all" placeholder="Search" />
        <SearchBox ariaLabel="Mobile search" value="" onChange={vi.fn()} staticSuggestions={suggestions} scope="all" placeholder="Search" />
      </>,
    )

    const controls = screen.getAllByRole('combobox').map((input) => input.getAttribute('aria-controls'))
    expect(new Set(controls).size).toBe(2)
  })

  it('skips malformed server suggestions and keeps valid results available', async () => {
    vi.useFakeTimers()
    vi.mocked(api.get).mockResolvedValue({
      data: {
        items: [
          null,
          { id: 2, text: { title: 'Invalid object' }, kind: 'internship', subtitle: 'Company', url: '/jobs/2' },
          { id: 3, text: 'Python Internship', kind: 'internship', subtitle: 'Company', url: '/jobs/3' },
        ],
      },
    } as never)
    render(
      <SearchBox
        ariaLabel="Search internships"
        value="python"
        onChange={vi.fn()}
        staticSuggestions={suggestions}
        scope="internships"
        placeholder="Search internships"
      />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: 'Search internships' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(screen.getByRole('option', { name: /Python Internship/ })).toBeInTheDocument()
    expect(screen.queryByText('Invalid object')).not.toBeInTheDocument()
  })

  it('skips malformed recent searches without breaking the header search list', () => {
    localStorage.setItem('internsphere_recent_searches', JSON.stringify({
      guest: { all: [null, 12, { text: 'Invalid object' }, 'Valid recent search'] },
    }))
    render(
      <SearchBox
        ariaLabel="Search InternSphere"
        value=""
        onChange={vi.fn()}
        staticSuggestions={suggestions}
        scope="all"
        placeholder="Search"
      />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: 'Search InternSphere' }))

    expect(screen.getByRole('option', { name: /Valid recent search/ })).toBeInTheDocument()
    expect(screen.queryByText('Invalid object')).not.toBeInTheDocument()
  })
})
