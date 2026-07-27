import { api } from '@/lib/api/client'
import type { Session } from '@/lib/api/types'
import { EMPTY_SESSION_FILTER, type SessionFilter, timeWindowStart } from '@/lib/session-filter'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

const PAGE_SIZE = 20

export const sessionKeys = {
  all: ['sessions'] as const,
  // Prefix shared by every session-list query of a workspace. Invalidating
  // this key matches all filter variants by prefix.
  list: (workspaceId: string | undefined) => ['sessions', workspaceId] as const,
  // Exact key of one list variant — needed for optimistic cache writes.
  listVariant: (workspaceId: string | undefined, filter: SessionFilter) =>
    ['sessions', workspaceId, filter] as const,
  facets: (workspaceId: string | undefined) => ['session-facets', workspaceId] as const,
}

export function useSessions(workspaceId: string | undefined, filter?: SessionFilter) {
  const effective = filter ?? EMPTY_SESSION_FILTER
  const query = useInfiniteQuery({
    queryKey: sessionKeys.listVariant(workspaceId, effective),
    queryFn: ({ pageParam = 0 }) =>
      api.getSessions(workspaceId!, {
        limit: PAGE_SIZE,
        offset: pageParam,
        starred: effective.starredOnly,
        excludeSources: effective.excludedSources,
        statuses: effective.statuses,
        activeAfter: timeWindowStart(effective.time),
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + PAGE_SIZE
      return nextOffset < lastPage.total ? nextOffset : undefined
    },
    enabled: !!workspaceId,
  })

  // Flatten all pages into a single sessions array for consumers
  const sessions = useMemo<Session[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )

  const total = query.data?.pages[0]?.total ?? 0

  return {
    ...query,
    data: sessions,
    total,
  }
}

/**
 * Session counts per facet, for labelling the filter menu. Deliberately
 * unfiltered: they describe the whole workspace, which is what lets the menu
 * explain a crowded list before the user has filtered anything.
 */
export function useSessionFacets(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: sessionKeys.facets(workspaceId),
    queryFn: () => api.getSessionFacets(workspaceId!),
    enabled: !!workspaceId && enabled,
    staleTime: 30_000,
  })
}

/** Returns a callback that invalidates the session list for a given workspace. */
export function useInvalidateSessions() {
  const queryClient = useQueryClient()
  return useCallback(
    (workspaceId: string) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list(workspaceId) })
      queryClient.invalidateQueries({ queryKey: sessionKeys.facets(workspaceId) })
    },
    [queryClient],
  )
}
