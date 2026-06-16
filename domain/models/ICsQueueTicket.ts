export type TicketQueueStatus = 'open' | 'pending' | 'start_contact'
export type PendingType = 'pendingAG2' | 'pendingShopper' | 'pendingClient'

export interface ICsQueueTicket {
  ticketId: string
  status: TicketQueueStatus
  pendingType?: PendingType
  priority?: number
  newMessagesCount: number
  openedAt: number
  inAttendanceBy: string[]
  createdAt: number
  updatedAt: number
}
