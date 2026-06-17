export type TicketQueueStatus = 'open' | 'pending' | 'start_contact'
export type PendingType = 'pendingAG2' | 'pendingShopper' | 'pendingClient'

export interface ICrmCsQueueWhatsappTicket {
  ticketId: string
  status: TicketQueueStatus
  pending_type?: PendingType
  priority?: number
  new_messages_count: number
  opened_at: number
  inAttendanceBy: string[]
  createdAt: number
  updatedAt: number
}
