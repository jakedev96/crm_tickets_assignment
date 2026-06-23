import 'reflect-metadata'

// Deve estar antes do import do use case (validação no module load)
process.env.AGENT_RESPONSE_ENDPOINT_URL = 'http://test-endpoint.local'
process.env.AGENT_RESPONSE_ENDPOINT_KEY = 'test-key'

import { SuggestAgentResponseUseCase } from '../../functions/domain/usecases/SuggestAgentResponseUseCase'
import type { IAgentResponseRepository } from '../../functions/domain/repositories/IAgentResponseRepository'
import type { ITicketMessage } from '../../functions/domain/models/ITicketMessage'

function makeRepo(): jest.Mocked<IAgentResponseRepository> {
  return {
    claimLock: jest.fn().mockResolvedValue(undefined),
    getCurrentLockHolder: jest.fn(),
    releaseLock: jest.fn().mockResolvedValue(undefined),
    readMessages: jest.fn(),
    saveSuggestion: jest.fn().mockResolvedValue(undefined),
  }
}

const MESSAGES: ITicketMessage[] = [
  { messageId: 'msg1', content: 'Preciso de ajuda', senderId: 'user1', createdAt: 1000 },
]

const SUGGESTION = { text: 'Olá, como posso ajudar?' }

async function advanceAllCycles() {
  await jest.advanceTimersByTimeAsync(12 * 15_000)
}

describe('SuggestAgentResponseUseCase', () => {
  let useCase: SuggestAgentResponseUseCase
  let repo: jest.Mocked<IAgentResponseRepository>

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    repo = makeRepo()
    useCase = new SuggestAgentResponseUseCase(repo)

    repo.getCurrentLockHolder.mockResolvedValue('msg1')
    repo.readMessages.mockResolvedValue(MESSAGES)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(SUGGESTION),
    } as unknown as Response)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // ── test_scenarios ──────────────────────────────────────────

  it('1 mensagem → aguarda 12 ciclos (180s) sem novas mensagens → chama endpoint → salva agentSuggestion', async () => {
    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    const result = await promise

    expect(result.executed).toBe(true)
    expect(result.aborted).toBe(false)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-endpoint.local',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(repo.saveSuggestion).toHaveBeenCalledWith('ticket1', SUGGESTION)
  })

  it('2 mensagens rápidas → 1ª invocação perde o lock para a 2ª → 1ª aborta, 2ª executa o fluxo', async () => {
    repo.getCurrentLockHolder.mockResolvedValue('msg2')

    const promise = useCase.execute('ticket1', 'msg1')
    await jest.advanceTimersByTimeAsync(15_000)
    const result = await promise

    expect(result.aborted).toBe(true)
    expect(result.executed).toBe(false)
    expect(repo.saveSuggestion).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('endpoint retorna 200 → agentSuggestion salvo no ticket com agentSuggestionUpdatedAt', async () => {
    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    const result = await promise

    expect(result.executed).toBe(true)
    expect(repo.saveSuggestion).toHaveBeenCalledWith('ticket1', SUGGESTION)
  })

  it('endpoint retorna 500 → agentSuggestion não salvo, lock liberado, log de erro', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 } as unknown as Response)

    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    const result = await promise

    expect(result.executed).toBe(false)
    expect(repo.saveSuggestion).not.toHaveBeenCalled()
    expect(repo.releaseLock).toHaveBeenCalledWith('ticket1')
  })

  it('ticket sem mensagens ao executar → fluxo não chama endpoint, log de aviso', async () => {
    repo.readMessages.mockResolvedValue([])

    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    const result = await promise

    expect(result.executed).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(repo.releaseLock).toHaveBeenCalledWith('ticket1')
  })

  it('AGENT_RESPONSE_ENDPOINT_URL ausente → cold start falha com erro explícito', () => {
    jest.isolateModules(() => {
      const savedUrl = process.env.AGENT_RESPONSE_ENDPOINT_URL
      const savedKey = process.env.AGENT_RESPONSE_ENDPOINT_KEY
      delete process.env.AGENT_RESPONSE_ENDPOINT_URL
      delete process.env.AGENT_RESPONSE_ENDPOINT_KEY

      expect(() => {
        require('../../functions/domain/usecases/SuggestAgentResponseUseCase')
      }).toThrow('[agent-response] Missing env')

      process.env.AGENT_RESPONSE_ENDPOINT_URL = savedUrl
      process.env.AGENT_RESPONSE_ENDPOINT_KEY = savedKey
    })
  })

  it('mensagens de tickets diferentes não interferem entre si (locks por ticketId)', async () => {
    repo.getCurrentLockHolder.mockImplementation(async (ticketId: string) => {
      if (ticketId === 'ticket1') return 'msg1'
      if (ticketId === 'ticket2') return 'msg2'
      return null
    })

    const promise1 = useCase.execute('ticket1', 'msg1')
    const promise2 = useCase.execute('ticket2', 'msg2')
    await advanceAllCycles()
    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(result1.executed).toBe(true)
    expect(result2.executed).toBe(true)
  })

  // ── error_cases ─────────────────────────────────────────────

  it('error: LOCK_LOST — aborta silenciosamente sem lançar exceção', async () => {
    repo.getCurrentLockHolder.mockResolvedValue('msg-other')

    const promise = useCase.execute('ticket1', 'msg1')
    await jest.advanceTimersByTimeAsync(15_000)

    await expect(promise).resolves.toEqual({
      executed: false,
      aborted: true,
      agentSuggestion: null,
    })
    expect(repo.saveSuggestion).not.toHaveBeenCalled()
  })

  it('error: ENDPOINT_ERROR — lock liberado (agentSuggestionJobId = null), agentSuggestion não salvo', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 } as unknown as Response)

    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    await promise

    expect(repo.releaseLock).toHaveBeenCalledWith('ticket1')
    expect(repo.saveSuggestion).not.toHaveBeenCalled()
  })

  it('error: NO_MESSAGES — endpoint não chamado, lock liberado', async () => {
    repo.readMessages.mockResolvedValue([])

    const promise = useCase.execute('ticket1', 'msg1')
    await advanceAllCycles()
    await promise

    expect(global.fetch).not.toHaveBeenCalled()
    expect(repo.releaseLock).toHaveBeenCalledWith('ticket1')
  })
})
