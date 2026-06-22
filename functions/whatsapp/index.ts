import { onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { whatsappAssign, whatsappReconcile } from '../implementation/channels/whatsapp/di'


export const onAgentAvailable = onDocumentWritten('agent/{agentId}', async event => {
  const agentId = event.params.agentId
  const before = event.data?.before?.data()
  const after = event.data?.after?.data()

  if (!after) return

  const enteredPassiveQueue = !before?.['waitingForNewTicket'] && !!after['waitingForNewTicket']
  if (!enteredPassiveQueue) return

  console.log(`[onAgentAvailable] agentId=${agentId} entered passive queue`)
  try {
    const result = await whatsappAssign.byAgent(agentId)
    if (result) {
      console.info(`[onAgentAvailable] agent=${result.agentName} assigned to ticketId=${result.ticketId}`)
    } else {
      console.info(`[onAgentAvailable] agent=${agentId} no tickets available`)
    }
  } catch (e) {
    console.error(`[onAgentAvailable] agent=${agentId} error:`, e)
  }
})

export const reconcileAssignments = onSchedule('every 30 seconds', async () => {
  try {
    const n = await whatsappReconcile.execute()
    if (n > 0) console.info(`[reconcile] ${n} ticket(s) assigned`)
  } catch (e) {
    console.error('[reconcile] error:', e)
  }
})
