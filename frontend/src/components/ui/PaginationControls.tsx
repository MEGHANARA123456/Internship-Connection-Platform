import { ChevronLeft, ChevronRight, ArrowUp } from 'lucide-react'
import { Button } from './Button'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationControlsProps) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4"
    >
      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
            leftIcon={<ChevronLeft className="h-3.5 w-3.5" />}
          >
            Previous
          </Button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              aria-label={`Page ${page}`}
              aria-current={currentPage === page ? 'page' : undefined}
              onClick={() => onPageChange(page)}
              className={`h-8 min-w-8 rounded-lg px-2 text-xs font-semibold transition-colors ${
                currentPage === page
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {page}
            </button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Next page"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
          >
            Next
          </Button>
        </div>
      ) : <span />}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        leftIcon={<ArrowUp className="h-3.5 w-3.5" />}
      >
        Back to top
      </Button>
    </nav>
  )
}
