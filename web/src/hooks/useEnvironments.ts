import { api } from '@/lib/api/client'
import type { ApiEnvironment, ApiEnvironmentGrant, ApiEnvironmentToken } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const environmentsQueryKey = ['environments'] as const
const environmentGrantsQueryKey = (id: string) => ['environment-grants', id] as const
const environmentTokensQueryKey = (id: string) => ['environment-tokens', id] as const

/** Environments visible to the user (own + public + team-shared, incl. built-in). */
export function useEnvironments() {
  return useQuery<ApiEnvironment[]>({
    queryKey: environmentsQueryKey,
    queryFn: () => api.listEnvironments(),
    // Heartbeat-driven online/offline changes out-of-band; refetch keeps the
    // list fresh while the section is open.
    refetchInterval: 15_000,
  })
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createEnvironment>[0]) => api.createEnvironment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentsQueryKey })
    },
  })
}

export function useUpdateEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateEnvironment>[1] }) =>
      api.updateEnvironment(id, data),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: environmentsQueryKey })
      queryClient.invalidateQueries({ queryKey: environmentGrantsQueryKey(id) })
    },
  })
}

export function useDeleteEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteEnvironment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentsQueryKey })
    },
  })
}

export function useEnvironmentGrants(id: string, enabled = true) {
  return useQuery<ApiEnvironmentGrant[]>({
    queryKey: environmentGrantsQueryKey(id),
    queryFn: () => api.listEnvironmentGrants(id),
    enabled: enabled && !!id,
  })
}

export function useEnvironmentTokens(id: string, enabled = true) {
  return useQuery<ApiEnvironmentToken[]>({
    queryKey: environmentTokensQueryKey(id),
    queryFn: () => api.listEnvironmentTokens(id),
    enabled: enabled && !!id,
  })
}

export function useCreateEnvironmentToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.createEnvironmentToken(id, name),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: environmentTokensQueryKey(id) })
    },
  })
}

export function useRevokeEnvironmentToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, tokenId }: { id: string; tokenId: string }) =>
      api.revokeEnvironmentToken(id, tokenId),
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({ queryKey: environmentTokensQueryKey(id) })
    },
  })
}
