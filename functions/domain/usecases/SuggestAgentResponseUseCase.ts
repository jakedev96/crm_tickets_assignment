import { inject, injectable } from 'tsyringe'
import type { IAgentResponseRepository } from '../repositories/IAgentResponseRepository'

const POLL_INTERVAL_MS = 15_000
const MAX_CYCLES = 12
const ENDPOINT_URL = process.env.AGENT_RESPONSE_ENDPOINT_URL
const ENDPOINT_KEY = process.env.AGENT_RESPONSE_ENDPOINT_KEY

if (!ENDPOINT_URL || !ENDPOINT_KEY) {
  throw new Error('[agent-response] Missing env: AGENT_RESPONSE_ENDPOINT_URL or AGENT_RESPONSE_ENDPOINT_KEY')
}

@injectable()
export class SuggestAgentResponseUseCase {
  constructor(
    @inject('AgentResponseRepository')
    private readonly repo: IAgentResponseRepository,
  ) {}

  async execute(ticketId: string, messageId: string): Promise<{ executed: boolean; aborted: boolean; agentSuggestion: object | null }> {
    // 1. Claim lock — escreve agentSuggestionJobId = messageId
    await this.repo.claimLock(ticketId, messageId)

    // 2. Poll loop — aguarda até MAX_CYCLES ciclos, cada ciclo com POLL_INTERVAL_MS
    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      await sleep(POLL_INTERVAL_MS)

      // 3. Verifica se ainda é o dono do lock
      const isOwned = await this.repo.isLockOwned(ticketId, messageId)
      if (!isOwned) {
        console.log(`[agent-response] ticketId=${ticketId} lock lost to another invocation, aborting`)
        return { executed: false, aborted: true, agentSuggestion: null }
      }
    }

    // 4. Após ciclos: lê mensagens
    const messages = await this.repo.readMessages(ticketId)
    if (messages.length === 0) {
      console.warn(`[agent-response] ticketId=${ticketId} no messages found, releasing lock`)
      await this.repo.releaseLock(ticketId)
      return { executed: false, aborted: false, agentSuggestion: null }
    }

    // 5. Chama o endpoint
    let agentSuggestion: object | null = null
    try {
      agentSuggestion = await this.callEndpoint(ticketId, messages)
    } catch (e) {
      console.error(`[agent-response] ticketId=${ticketId} endpoint error:`, e)
      await this.repo.releaseLock(ticketId)
      return { executed: false, aborted: false, agentSuggestion: null }
    }

    // 6. Salva a sugestão
    await this.repo.saveSuggestion(ticketId, agentSuggestion)
    return { executed: true, aborted: false, agentSuggestion }
  }

  private async callEndpoint(
    ticketId: string,
    messages: Array<{ content: string; senderId: string; createdAt: number }>,
  ): Promise<object> {
    const response = await fetch(ENDPOINT_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENDPOINT_KEY}`,
      },
      body: JSON.stringify({
        ticketId,
        messages,
      }),
    })

    if (!response.ok) {
      throw new Error(`Endpoint returned status ${response.status}`)
    }

    return response.json()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
