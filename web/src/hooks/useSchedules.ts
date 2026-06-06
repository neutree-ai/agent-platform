import { api } from '@/lib/api/client'
import type { Schedule } from '@/lib/api/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function useSchedules(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: ['schedules', workspaceId],
    queryFn: () => api.listSchedules(workspaceId),
    enabled,
  })
}

export function useCreateSchedule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      cron?: string | null
      run_at?: string | null
      timezone: string
      prompt: string
      prompt_id?: string | null
    }) => api.createSchedule(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', workspaceId] })
    },
  })
}

export function useUpdateSchedule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<
      Pick<Schedule, 'name' | 'cron' | 'run_at' | 'timezone' | 'prompt' | 'prompt_id' | 'enabled'>
    >) => api.updateSchedule(workspaceId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', workspaceId] })
    },
  })
}

export function useDeleteSchedule(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSchedule(workspaceId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', workspaceId] })
    },
  })
}

export function useRunSchedule(workspaceId: string) {
  return useMutation({
    mutationFn: (id: string) => api.runSchedule(workspaceId, id),
  })
}
