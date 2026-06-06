import { api } from '@/lib/api/client'
import type { Session } from '@/lib/api/types'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

const PAGE_SIZE = 20

export const sessionKeys = {
  all: ['sessions'] as const,
  // Prefix shared by every session-list query of a workspace. Invalidating
  // this key matches all variants (starred-filtered and not) by prefix.
  list: (workspaceId: string | undefined) => ['sessions', workspaceId] as const,
  // Exact key of one list variant — needed for optimistic cache writes.
  listVariant: (workspaceId: string | undefined, starred: boolean) =>
    ['sessions', workspaceId, { starred }] as const,
}

export function useSessions(workspaceId: string | undefined, opts?: { starred?: boolean }) {
  const starred = opts?.starred ?? false
  const query = useInfiniteQuery({
    queryKey: sessionKeys.listVariant(workspaceId, starred),
    queryFn: ({ pageParam = 0 }) =>
      api.getSessions(workspaceId!, { limit: PAGE_SIZE, offset: pageParam, starred }),
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

/** Returns a callback that invalidates the session list for a given workspace. */
export function useInvalidateSessions() {
  const queryClient = useQueryClient()
  return useCallback(
    (workspaceId: string) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list(workspaceId) })
    },
    [queryClient],
  )
}
