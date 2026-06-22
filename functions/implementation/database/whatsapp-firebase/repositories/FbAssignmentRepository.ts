import { inject, injectable } from 'tsyringe'
import { FieldValue, type Transaction, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore'
import { db } from '../firebase'
import { IAssignmentRepository } from '../../../../domain/repositories/IAssignmentRepository'
import { IChannelConfig } from '../../../../domain/models/IChannelConfig'
import { AgentRole } from '../../../../domain/models/channels/whatsapp/IAgent'

const AGENT_COLLECTION = 'agent'
const AGENT_HEARTBEAT_COLLECTION = 'agent_heartbeat'
const HEARTBEAT_TTL_MS = 30_000
const HEARTBEAT_MAX_FUTURE_MS = 10_000

function firestoreTimeToMs(val: unknown): number {
  if (!val) return 0
  if (typeof val === 'number') return val
  if (typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis()
  }
  return 0
}

function isHeartbeatFresh(heartbeatMs: number, now: number): boolean {
  if (!heartbeatMs) return false
  const age = now - heartbeatMs
  return age <= HEARTBEAT_TTL_MS && age >= -HEARTBEAT_MAX_FUTURE_MS
}

function isAgentStillAvailable(data: Record<string, unknown>, heartbeatMs: number, now: number): boolean {
  return data['inAttendanceAt'] === 0 && !!data['waitingForNewTicket'] && isHeartbeatFresh(heartbeatMs, now)
}

function isAlreadyAssigned(doc: DocumentSnapshot): boolean {
  return ((doc.get('inAttendanceBy') as string[])?.length ?? 0) > 0
}

function availableAgentsBaseQuery() {
  return db
    .collection(AGENT_COLLECTION)
    .where('inAttendanceAt', '==', 0)
    .where('waitingForNewTicket', '!=', 0)
    .orderBy('waitingForNewTicket', 'asc')
}

@injectable()
export class FbAssignmentRepository implements IAssignmentRepository {
  constructor(@inject('ChannelConfig') private readonly config: IChannelConfig) {}

private async selectNextTicketId(tx: Transaction, agentRole: AgentRole): Promise<string | null> {
    const base = db.collection(this.config.queueCollection).where('inAttendanceBy', '==', [])

    if (agentRole === 'AG2') {
      for (const pType of this.config.pendingTypesAG2Only) {
        const snap = await tx.get(
          base.where('status', '==', 'pending').where('pending_type', '==', pType).orderBy('opened_at', 'asc').limit(1)
        )
        if (!snap.empty) {
          console.log(`[repo:selectNextTicketId] ticketId=${snap.docs[0].id} via AG2 (pending_type=${pType})`)
          return snap.docs[0].id
        }
      }
    }

    // Layer 3: pendingClient with new messages
    const withMsgs = await tx.get(
      base
        .where('status', '==', 'pending')
        .where('pending_type', '==', 'pendingClient')
        .where('new_messages_count', '>', 0)
        .orderBy('new_messages_count', 'asc')
        .orderBy('opened_at', 'asc')
        .limit(1)
    )

    if (!withMsgs.empty) {
      console.log(`[repo:selectNextTicketId] ticketId=${withMsgs.docs[0].id} via pendingClient with new messages`)
      return withMsgs.docs[0].id
    }

    // Layer 4: open — FIFO
    const open = await tx.get(
      base.where('status', '==', 'open').orderBy('opened_at', 'asc').limit(1)
    )

    if (!open.empty) {
      console.log(`[repo:selectNextTicketId] ticketId=${open.docs[0].id} via open status`)
      return open.docs[0].id
    }

    console.log(`[repo:selectNextTicketId] no tickets available (role=${agentRole})`)
    return null
  }

  private async commitAssignment(
    tx: Transaction,
    queueRef: DocumentReference,
    ticketRef: DocumentReference,
    agentRef: DocumentReference,
    agentId: string
  ): Promise<void> {
    console.log(`[repo:commitAssignment] ticketId=${ticketRef.id} agentId=${agentId}`)
    const now = FieldValue.serverTimestamp()
    tx.update(queueRef, {
      inAttendanceBy: [agentId],
      updatedAt: Date.now()
    })
    tx.update(ticketRef, {
      user_id: agentId,
      attendedBy: FieldValue.arrayUnion(agentId),
      inAttendanceBy: [agentId],
      updatedAt: now
    })
    tx.update(agentRef, {
      inAttendanceAt: now,
      waitingForNewTicket: 0,
      updatedAt: now
    })
    const heartbeatRef = db.collection(AGENT_HEARTBEAT_COLLECTION).doc(agentRef.id)
    tx.set(heartbeatRef, { queueListenerHeartbeatAt: 0, queueListenerHeartbeatRequestId: 0 }, { merge: true })
  }

  async assignByAgent(agentId: string): Promise<{ ticketId: string; agentName: string } | null> {
    return db.runTransaction(async (tx: Transaction) => {
      const agentRef = db.collection(AGENT_COLLECTION).doc(agentId)
      const agentDoc = await tx.get(agentRef)
      if (!agentDoc.exists) return null

      const now = Date.now()
      const agentData = agentDoc.data() as Record<string, unknown>
      const heartbeatRef = db.collection(AGENT_HEARTBEAT_COLLECTION).doc(agentId)
      const heartbeatDoc = await tx.get(heartbeatRef)
      const heartbeatMs = firestoreTimeToMs(heartbeatDoc.get('queueListenerHeartbeatAt'))
      const available = isAgentStillAvailable(agentData, heartbeatMs, now)

      console.log(
        `[repo:assignByAgent] agentId=${agentId} role=${agentData['role']} heartbeatAge=${now - heartbeatMs}ms available=${available}`
      )
      if (!available) return null

      const agentRole: AgentRole = (agentData['role'] as AgentRole) ?? 'AG1'
      const ticketId = await this.selectNextTicketId(tx, agentRole)
      if (!ticketId) return null

      const queueRef = db.collection(this.config.queueCollection).doc(ticketId)
      const ticketRef = db.collection(this.config.ticketsCollection).doc(ticketId)

      const [queueDoc, ticketDoc] = await Promise.all([tx.get(queueRef), tx.get(ticketRef)])
      if (!queueDoc.exists || !ticketDoc.exists) {
        console.warn(`[repo:assignByAgent] ticketId=${ticketId} document missing in transaction`)
        return null
      }

      if (isAlreadyAssigned(ticketDoc)) {
        console.warn(`[repo:assignByAgent] ticketId=${ticketId} already assigned in transaction`)
        return null
      }

      const agentName = agentDoc.get('name')
      await this.commitAssignment(tx, queueRef, ticketRef, agentRef, agentId)
      console.info(`[repo:assignByAgent] ticketId=${ticketId} → assigned to agent= ${agentName}`)
      return { ticketId, agentName }
    })
  }

  async reconcile(): Promise<number> {
    const snap = await availableAgentsBaseQuery().get()
    const now = Date.now()

    let count = 0

    for (const doc of snap.docs) {
      const heartbeatDoc = await db.collection(AGENT_HEARTBEAT_COLLECTION).doc(doc.id).get()
      const heartbeatMs = firestoreTimeToMs(heartbeatDoc.get('queueListenerHeartbeatAt'))
      if (!isHeartbeatFresh(heartbeatMs, now)) continue
      const result = await this.assignByAgent(doc.id)
      if (result) count++
    }

    return count
  }
}
