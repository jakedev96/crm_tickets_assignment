import { injectable } from 'tsyringe'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from '../database/whatsapp-firebase/firebase'
import type { IAgentResponseRepository } from '../../domain/repositories/IAgentResponseRepository'
import type { ITicketMessage } from '../../domain/models/ITicketMessage'

const TICKETS_COLLECTION = 'tickets'

@injectable()
export class FbAgentResponseRepository implements IAgentResponseRepository {
  async claimLock(ticketId: string, messageId: string): Promise<void> {
    await db.collection(TICKETS_COLLECTION).doc(ticketId).update({
      agentSuggestionJobId: messageId,
    })
  }

  async getCurrentLockHolder(ticketId: string): Promise<string | null> {
    const snap = await db.collection(TICKETS_COLLECTION).doc(ticketId).get()
    return snap.get('agentSuggestionJobId') ?? null
  }

  async releaseLock(ticketId: string): Promise<void> {
    await db.collection(TICKETS_COLLECTION).doc(ticketId).update({
      agentSuggestionJobId: null,
    })
  }

  async readMessages(ticketId: string): Promise<ITicketMessage[]> {
    const snap = await db
      .collection(TICKETS_COLLECTION)
      .doc(ticketId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .get()

    return snap.docs.map(doc => ({
      messageId: doc.id,
      content: doc.get('content') as string,
      senderId: doc.get('senderId') as string,
      createdAt: doc.get('createdAt') as number,
    }))
  }

  async saveSuggestion(ticketId: string, suggestion: unknown): Promise<void> {
    await db.collection(TICKETS_COLLECTION).doc(ticketId).update({
      agentSuggestion: suggestion,
      agentSuggestionUpdatedAt: FieldValue.serverTimestamp(),
    })
  }
}
