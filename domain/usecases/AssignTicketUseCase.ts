import { inject, injectable } from 'tsyringe'
import { IAssignmentRepository } from '../repositories/IAssignmentRepository'

@injectable()
export class AssignTicketUseCase {
  constructor(@inject('AssignmentRepository') private readonly repo: IAssignmentRepository) {}

  byAgent  = (agentId: string)  => this.repo.assignByAgent(agentId)
  byTicket = (ticketId: string) => this.repo.assignByTicket(ticketId)
}
