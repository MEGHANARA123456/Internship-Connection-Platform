import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient()

export function clearUserCaches(): void {
  try {
    queryClient.clear()
  } catch (error) {
    console.error('Failed to clear query client cache:', error)
  }
}

