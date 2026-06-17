import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { whatsappAssign, whatsappReconcile } from '../implementation/channels/whatsapp/di'

const QUEUE_STATUSES = ['open', 'pending', 'start_contact']

export const onWhatsAppTicketEnqueued = onDocumentWritten('crm_cs_queue/{ticketId}', async event => {
  const after = event.data?.after?.data()
  if (!after || (after['inAttendanceBy'] as string[])?.length > 0) return
  if (!QUEUE_STATUSES.includes(after['status'])) return

  try {
    await whatsappAssign.byTicket(event.params.ticketId)
  } catch (e) {
    console.error('[whatsapp] onTicketEnqueued:', e)
  }
})

export const onAgentAvailable = onDocumentWritten('agent/{agentId}', async event => {
  const before = event.data?.before?.data()
  const after = event.data?.after?.data()
  if (!after) return

  const enteredPassiveQueue = !before?.['waitingForNewTicket'] && !!after['waitingForNewTicket']
  if (!enteredPassiveQueue) return

  const agentId = event.params.agentId

  try {
    const result = await whatsappAssign.byAgent(agentId)
    if (!result) console.info(`[agent] ${agentId} entrou na fila passiva mas não há tickets disponíveis`)
  } catch (e) {
    console.error('[agent] onAgentAvailable:', e)
  }
})

export const reconcileAssignments = onSchedule('every 1 minutes', async () => {
  try {
    const n = await whatsappReconcile.execute()
    if (n > 0) console.info(`Reconciler atribuiu ${n} ticket(s)`)
  } catch (e) {
    console.error('Reconciler:', e)
  }
})
