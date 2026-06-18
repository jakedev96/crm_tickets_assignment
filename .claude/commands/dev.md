# Skill: dev

Guia de implementação do projeto `ticket-assigner`. Toda vez que for implementar algo neste projeto, siga rigorosamente as regras abaixo.

---

## Arquitetura obrigatória

O projeto segue separação em camadas com inversão de dependência. Respeite sempre esta hierarquia:

```
index.ts (triggers)
  └── domain/usecases/         ← regras de negócio, sem imports do Firebase
        └── domain/repositories/  ← interfaces puras (portas)
              └── implementation/  ← Firestore, DI, configs de canal
```

**Regras rígidas:**
- `domain/` jamais importa nada de `implementation/`, `firebase-admin` ou `tsyringe`
- Toda nova regra de negócio vai em um use case em `domain/usecases/`
- Toda nova query ou escrita no Firestore vai em `implementation/database/firebase/repositories/`
- Interfaces novas de modelo vão em `domain/models/`

---

## Princípios SOLID aplicados ao projeto

**S — Single Responsibility**
- Um use case = uma responsabilidade. `AssignTicketUseCase` só atribui; `ReconcileAssignmentsUseCase` só reconcilia.
- Se um método crescer além de uma responsabilidade, extraia um método privado ou um novo use case.

**O — Open/Closed**
- Novos canais são adicionados sem modificar `FbAssignmentRepository`, `AssignTicketUseCase` ou qualquer arquivo de domínio.
- Extensão via `IChannelConfig` + child container do tsyringe + novo arquivo em `implementation/channels/<nome>/`.

**L — Liskov Substitution**
- Qualquer implementação de `IAssignmentRepository` deve poder substituir `FbAssignmentRepository` sem quebrar os use cases.
- Ao criar implementações alternativas (ex: para testes), garanta que todos os contratos da interface sejam honrados.

**I — Interface Segregation**
- `IAssignmentRepository` expõe apenas `assignByAgent`, `assignByTicket` e `reconcile`. Não adicione métodos que só uma implementação específica precisa.

**D — Dependency Inversion**
- Use cases dependem de `IAssignmentRepository` (interface), nunca de `FbAssignmentRepository` (implementação).
- Toda dependência nova deve ser injetada via `@inject()` do tsyringe, nunca instanciada com `new` dentro de uma classe.

---

## Padrões de código obrigatórios

**Transações Firestore (anti-corrida):**
- Todas as leituras (`tx.get()`) ANTES de qualquer escrita (`tx.update()`/`tx.set()`)
- Sempre revalidar o estado dentro da transação antes do commit
- Nunca ler fora da transação e escrever dentro sem reler

**Disponibilidade do agente:**
- Nunca usar campo `status` no documento do agente — ele não existe
- Fase 2 (motor age): `inAttendanceAt == 0` AND `waitingForNewTicket != 0`
- Sempre checar `isHeartbeatFresh()` antes de usar um agente

**Fila de tickets:**
- Usar `inAttendanceBy == []` para identificar tickets disponíveis (alinhado com a UI)
- Atualizar `inAttendanceBy` na `crm_cs_queue` E no documento de `tickets` na mesma transação

**Novos campos de agente ou fila:**
- Campos novos no agente → atualizar `domain/models/channels/whatsapp/IAgent.ts`
- Campos novos na fila → atualizar `domain/models/channels/whatsapp/ICrmCsQueueWhatsappTicket.ts`

**Imports de tipos:**
- Usar `import type` para tipos usados apenas como anotação (ex: `import type { Transaction } from 'firebase-admin/firestore'`)

---

## Adicionando um novo canal

1. Criar `implementation/channels/<nome>/config.ts` com `IChannelConfig`
2. Criar `implementation/channels/<nome>/di.ts` com child container
3. Adicionar trigger de ticket em `index.ts`
4. Adicionar `?? novoCanal.byAgent(agentId)` no `onAgentAvailable`
5. Adicionar `novoCanal.execute()` no `Promise.all` do reconciler
6. **Nenhum arquivo de domínio ou repositório deve ser alterado**

---

## README

Após qualquer implementação que altere:
- O modelo de dados (`agent`, `crm_cs_queue`, `tickets`)
- A fila de prioridade ou suas camadas
- Os estados do agente
- A adição de um novo canal
- As variáveis de ambiente
- Os scripts de build/deploy
- A estrutura de pastas

**Atualize o `README.md` na seção correspondente.** Não documente detalhes de implementação interna — apenas o que é relevante para quem vai usar ou operar o projeto.

---

## O que não fazer

- Não adicionar campo `status` ao documento do agente
- Não usar `isUnassigned` — o projeto usa `inAttendanceBy == []`
- Não instanciar `FbAssignmentRepository` diretamente — sempre via container
- Não colocar lógica de Firestore em use cases ou models
- Não adicionar comentários que descrevem o que o código faz — apenas o porquê quando não for óbvio
- Não criar abstrações antecipadas para cenários hipotéticos
