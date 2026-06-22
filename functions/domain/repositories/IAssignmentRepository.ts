export interface IAssignmentRepository {
  assignByAgent(agentId: string): Promise<{ ticketId: string; agentName: string } | null>
  reconcile(): Promise<number>
}
