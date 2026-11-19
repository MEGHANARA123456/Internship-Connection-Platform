import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 15_000,            // poll every 15 seconds
      refetchIntervalInBackground: false, // pause when the tab is hidden
      retry: 1,
    },
  },
})

export function clearUserCaches(): void {
  try {
    queryClient.clear()
  } catch (error) {
    console.error('Failed to clear query client cache:', error)
  }
}

