export interface IAssignmentRepository {
  assignByAgent(agentId: string): Promise<{ ticketId: string; agentId: string } | null>
  assignByTicket(ticketId: string): Promise<{ ticketId: string; agentId: string } | null>
  reconcile(): Promise<number>
}
