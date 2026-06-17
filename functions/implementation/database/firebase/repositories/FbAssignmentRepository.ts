import { inject, injectable } from 'tsyringe'
import { FieldValue, type Transaction, type DocumentReference } from 'firebase-admin/firestore'
import { db } from '../firebase'
import { IAssignmentRepository } from '../../../../domain/repositories/IAssignmentRepository'
import { IChannelConfig } from '../../../../domain/models/IChannelConfig'
import { AgentRole } from '../../../../domain/models/channels/whatsapp/IAgent'

const AGENT_COLLECTION        = 'agent'
const HEARTBEAT_TTL_MS        = 30_000
const HEARTBEAT_MAX_FUTURE_MS = 10_000
const AGENT_CANDIDATE_LIMIT   = 10

const OPEN_STATUSES = ['open', 'pending', 'start_contact'] as const

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

@injectable()
export class FbAssignmentRepository implements IAssignmentRepository {

  constructor(@inject('ChannelConfig') private readonly config: IChannelConfig) {}

  private async selectAvailableAgentRef(
    tx: Transaction,
    pendingType: string | undefined,
    now: number
  ): Promise<DocumentReference | null> {
    const base = db.collection(AGENT_COLLECTION)
      .where('inAttendanceAt', '==', 0)
      .where('waitingForNewTicket', '!=', 0)
      .orderBy('waitingForNewTicket', 'asc')

    const needsAG2 = pendingType !== undefined && this.config.pendingTypesAG2Only.includes(pendingType)
    const q = needsAG2
      ? base.where('role', '==', 'AG2').limit(AGENT_CANDIDATE_LIMIT)
      : base.limit(AGENT_CANDIDATE_LIMIT)

    const snap = await tx.get(q)

    for (const doc of snap.docs) {
      const d = doc.data()
      if (d['inAttendanceAt'] !== 0 || !d['waitingForNewTicket']) continue
      if (!isHeartbeatFresh(firestoreTimeToMs(d['queueListenerHeartbeatAt']), now)) continue
      return doc.ref
    }
    return null
  }

  private async selectNextTicketRef(
    tx: Transaction,
    agentRole: AgentRole
  ): Promise<DocumentReference | null> {
    const base = db.collection(this.config.queueCollection).where('inAttendanceBy', '==', [])

    if (agentRole === 'AG2') {
      for (const pType of this.config.pendingTypesAG2Only) {
        const snap = await tx.get(
          base
            .where('status', '==', 'pending')
            .where('pending_type', '==', pType)
            .orderBy('opened_at', 'asc')
            .limit(1)
        )
        if (!snap.empty) return snap.docs[0].ref
      }
    }

    // Camada 3: pendingClient com novas mensagens
    const withMsgs = await tx.get(
      base
        .where('status', '==', 'pending')
        .where('pending_type', '==', 'pendingClient')
        .where('new_messages_count', '>', 0)
        .orderBy('new_messages_count', 'asc') // Firestore: obrigatório no campo do range filter
        .orderBy('opened_at', 'asc')
        .limit(1)
    )
    if (!withMsgs.empty) return withMsgs.docs[0].ref

    // Camada 4: open — escalado primeiro, depois FIFO
    const open = await tx.get(
      base
        .where('status', '==', 'open')
        .orderBy('priority', 'desc')
        .orderBy('opened_at', 'asc')
        .limit(1)
    )
    return open.empty ? null : open.docs[0].ref
  }

  private async commitAssignment(
    tx: Transaction,
    queueRef: DocumentReference,
    ticketRef: DocumentReference,
    agentRef: DocumentReference,
    ticketId: string,
    agentId: string
  ): Promise<void> {
    const now = FieldValue.serverTimestamp()
    tx.update(queueRef,  { inAttendanceBy: [agentId], updatedAt: Date.now() })
    tx.update(ticketRef, {
      user_id:        agentId,
      attendedBy:     FieldValue.arrayUnion(agentId),
      inAttendanceBy: [agentId],
      status:         'inAttendance',
      updatedAt:      now,
    })
    tx.update(agentRef, {
      inAttendanceAt:                  now,
      waitingForNewTicket:             0,
      queueListenerHeartbeatAt:        0,
      queueListenerHeartbeatRequestId: 0,
      currentTicketId:                 ticketId,
      updatedAt:                       now,
    })
  }

  async assignByAgent(agentId: string): Promise<{ ticketId: string; agentId: string } | null> {
    return db.runTransaction(async (tx) => {
      const agentRef = db.collection(AGENT_COLLECTION).doc(agentId)
      const agentDoc = await tx.get(agentRef)
      if (!agentDoc.exists) return null

      const agent = agentDoc.data()!
      if (agent['inAttendanceAt'] !== 0 || !agent['waitingForNewTicket']) return null

      const now = Date.now()
      if (!isHeartbeatFresh(firestoreTimeToMs(agent['queueListenerHeartbeatAt']), now)) return null

      const agentRole: AgentRole = agent['role'] ?? 'AG1'
      const queueRef = await this.selectNextTicketRef(tx, agentRole)
      if (!queueRef) return null

      const queueDoc = await tx.get(queueRef)
      if ((queueDoc.get('inAttendanceBy') as string[])?.length > 0) return null

      const ticketId: string = queueDoc.get('ticketId')
      const ticketRef = db.collection(this.config.ticketsCollection).doc(ticketId)
      const ticketDoc = await tx.get(ticketRef)
      if (!ticketDoc.exists) return null
      if ((ticketDoc.get('inAttendanceBy') as string[])?.length > 0) return null

      await this.commitAssignment(tx, queueRef, ticketRef, agentRef, ticketId, agentId)
      return { ticketId, agentId }
    })
  }

  async assignByTicket(ticketId: string): Promise<{ ticketId: string; agentId: string } | null> {
    return db.runTransaction(async (tx) => {
      const queueRef = db.collection(this.config.queueCollection).doc(ticketId)
      const queueDoc = await tx.get(queueRef)
      if (!queueDoc.exists || (queueDoc.get('inAttendanceBy') as string[])?.length > 0) return null

      const status: string = queueDoc.get('status')
      if (!(OPEN_STATUSES as readonly string[]).includes(status)) return null

      const pendingType: string | undefined = queueDoc.get('pending_type')
      const now = Date.now()
      const agentRef = await this.selectAvailableAgentRef(tx, pendingType, now)
      if (!agentRef) return null

      const agentDoc = await tx.get(agentRef)
      const agent = agentDoc.data()!
      if (agent['inAttendanceAt'] !== 0 || !agent['waitingForNewTicket']) return null
      if (pendingType && this.config.pendingTypesAG2Only.includes(pendingType) && agent['role'] !== 'AG2') return null

      const ticketRef = db.collection(this.config.ticketsCollection).doc(ticketId)
      const ticketDoc = await tx.get(ticketRef)
      if (!ticketDoc.exists) return null
      if ((ticketDoc.get('inAttendanceBy') as string[])?.length > 0) return null

      const agentId = agentRef.id
      await this.commitAssignment(tx, queueRef, ticketRef, agentRef, ticketId, agentId)
      return { ticketId, agentId }
    })
  }

  async reconcile(): Promise<number> {
    const snap = await db
      .collection(AGENT_COLLECTION)
      .where('inAttendanceAt', '==', 0)
      .where('waitingForNewTicket', '!=', 0)
      .orderBy('waitingForNewTicket', 'asc')
      .get()

    const now = Date.now()
    let count = 0

    for (const doc of snap.docs) {
      const d = doc.data()
      if (!isHeartbeatFresh(firestoreTimeToMs(d['queueListenerHeartbeatAt']), now)) continue
      const result = await this.assignByAgent(doc.id)
      if (result) count++
    }

    return count
  }
}
