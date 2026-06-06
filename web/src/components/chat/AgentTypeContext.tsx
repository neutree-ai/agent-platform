import { createContext, useContext } from 'react'

const AgentTypeContext = createContext<string>('claude-code')

export const AgentTypeProvider = AgentTypeContext.Provider

export function useAgentType(): string {
  return useContext(AgentTypeContext)
}
