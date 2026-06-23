import type { ITicketMessage } from '../models/ITicketMessage'

export interface IAgentResponseRepository {
  claimLock(ticketId: string, messageId: string): Promise<void>
  getCurrentLockHolder(ticketId: string): Promise<string | null>
  releaseLock(ticketId: string): Promise<void>
  readMessages(ticketId: string): Promise<ITicketMessage[]>
  saveSuggestion(ticketId: string, suggestion: unknown): Promise<void>
}
