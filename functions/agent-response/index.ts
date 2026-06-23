import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { container } from 'tsyringe'
import { SuggestAgentResponseUseCase } from '../domain/usecases/SuggestAgentResponseUseCase'
import { FbAgentResponseRepository } from '../implementation/agent-response/FbAgentResponseRepository'

// Register repository in container (for dependency injection)
container.registerSingleton('AgentResponseRepository', FbAgentResponseRepository)

const suggestAgentResponse = container.resolve(SuggestAgentResponseUseCase)

export const onMessageCreated = onDocumentCreated(
  {
    document: 'tickets/{ticketId}/messages/{messageId}',
    timeoutSeconds: 180,
    memory: '256MiB',
    region: 'us-central1',
  },
  async event => {
    const ticketId = event.params.ticketId
    const messageId = event.params.messageId
    const message = event.data?.data()

    if (!message) {
      console.warn(`[agent-response] ticketId=${ticketId} messageId=${messageId} no message data, skipping`)
      return
    }

    try {
      const result = await suggestAgentResponse.execute(ticketId, messageId)
      if (result.executed) {
        console.info(`[agent-response] ticketId=${ticketId} suggestion executed and saved`)
      } else if (result.aborted) {
        console.info(`[agent-response] ticketId=${ticketId} execution aborted (lock lost)`)
      } else {
        console.info(`[agent-response] ticketId=${ticketId} execution completed (no suggestion generated)`)
      }
    } catch (e) {
      console.error(`[agent-response] ticketId=${ticketId} error:`, e)
    }
  },
)
