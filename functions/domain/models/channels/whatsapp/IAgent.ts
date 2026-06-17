export type AgentRole = 'AG1' | 'AG2'

export interface IAgent {
  agentId: string
  role: AgentRole
  availableAt: number
  inAttendanceAt: number
  waitingForNewTicket: number
  queueListenerHeartbeatAt: number
  queueListenerHeartbeatRequestId: number
  currentTicketId?: string
  updatedAt: number
}
