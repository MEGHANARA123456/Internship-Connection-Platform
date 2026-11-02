import { QueryObserver } from '@tanstack/react-query'
import { useMemo, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { queryClient } from '../lib/queryClient'

export interface CompanyMetric {
  value: number
  sample_size: number
  definition: string
}

export interface CompanyMetrics {
  kpis: Record<string, CompanyMetric>
  status_counts: Record<string, number>
  all_status_counts: Record<string, number>
  applications_by_role: Array<{
    id: number
    title: string
    status: string
    applications: number
    status_counts: Record<string, number>
  }>
  withdrawn_count: number
}

export const COMPANY_METRICS_QUERY_KEY = ['company', 'metrics'] as const

export function useCompanyMetrics(enabled = true, internshipId: number | null = null) {
  const observer = useMemo(
    () => new QueryObserver<CompanyMetrics>(queryClient, {
      queryKey: [...COMPANY_METRICS_QUERY_KEY, internshipId ?? 'all'],
      queryFn: async () => {
        const path = internshipId == null
          ? '/companies/me/metrics'
          : `/companies/me/metrics?internship_id=${internshipId}`
        const response = await api.get(path)
        return response.data as CompanyMetrics
      },
      staleTime: 0,
      enabled,
    }),
    [enabled, internshipId],
  )
  const subscribe = useMemo(() => (onStoreChange: () => void) => observer.subscribe(onStoreChange), [observer])
  const getSnapshot = useMemo(() => () => observer.getCurrentResult(), [observer])
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  )
  return {
    data: snapshot.data,
    loading: snapshot.isPending && snapshot.fetchStatus !== 'idle',
    error: snapshot.isError,
    retry: () => { void observer.refetch() },
  }
}

export function invalidateCompanyMetrics(): void {
  void queryClient.invalidateQueries({ queryKey: COMPANY_METRICS_QUERY_KEY })
}
