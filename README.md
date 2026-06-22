# ticket-assigner

Motor de atribuição de tickets de CS para canais de atendimento da Shopper. Distribui tickets da fila Firestore para agentes disponíveis com garantia de anti-corrida via transações atômicas.

---

## Sumário

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Fila de prioridade](#fila-de-prioridade)
- [Estados do agente](#estados-do-agente)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Rodando localmente](#rodando-localmente)
- [Build e deploy](#build-e-deploy)
- [Adicionando um novo canal](#adicionando-um-novo-canal)
- [Testes](#testes)

---

## Visão geral

O motor expõe duas Cloud Functions Firebase:

| Function | Trigger | Responsabilidade |
|---|---|---|
| `onAgentAvailable` | Escrita em `agent/{agentId}` | Agente entra na fila passiva → busca ticket compatível |
| `reconcileAssignments` | Schedule — a cada 30 segundos | Rede de segurança para eventos que os listeners perderam |

Toda atribuição é feita dentro de uma **transação Firestore** que lê e revalida o estado antes de escrever, prevenindo atribuições duplas mesmo sob alta concorrência. O SDK reexecuta a transação automaticamente em caso de contenção (até 5×).

---

## Arquitetura

O projeto segue arquitetura em camadas com inversão de dependência (DI via [tsyringe](https://github.com/microsoft/tsyringe)):

```
Triggers (index.ts)
    │
    ▼
Use Cases (domain/usecases/)
    │  depende de interface →
    ▼
IAssignmentRepository (domain/repositories/)
    │  implementado por →
    ▼
FbAssignmentRepository (implementation/database/firebase/)
    │
    ▼
Firestore (Firebase Admin SDK)
```

**Camada de domínio** (`domain/`) não importa nada do Firebase — contém apenas regras de negócio puras, interfaces e modelos. Isso permite testar os use cases com repositórios fake sem tocar no banco.

**Canal** (`IChannelConfig`) torna o motor agnóstico de canal. Cada canal registra sua própria configuração via child container do tsyringe — o repositório e os use cases são os mesmos para todos.

---

## Estrutura de pastas

```
ticket-assigner/
├── functions/
│   ├── index.ts                          # Entrypoint — re-exporta os módulos de canal
│   ├── whatsapp/
│   │   └── index.ts                      # Cloud Functions do canal WhatsApp
│   ├── domain/
│   │   ├── models/
│   │   │   ├── IChannelConfig.ts         # Configuração por canal (compartilhado)
│   │   │   └── channels/
│   │   │       └── whatsapp/
│   │   │           ├── IAgent.ts         # Tipo do agente e AgentRole (AG1 | AG2)
│   │   │           └── ICrmCsQueueWhatsappTicket.ts  # Tipo do documento de fila
│   │   ├── repositories/
│   │   │   └── IAssignmentRepository.ts  # Porta — interface pura
│   │   └── usecases/
│   │       ├── AssignTicketUseCase.ts    # byAgent / byTicket
│   │       └── ReconcileAssignmentsUseCase.ts
│   └── implementation/
│       ├── channels/
│       │   └── whatsapp/
│       │       ├── config.ts             # Configuração do canal WhatsApp
│       │       └── di.ts                 # Child container + instâncias exportadas
│       └── database/
│           └── whatsapp-firebase/
│               ├── firebase.ts           # initializeApp + export db
│               └── repositories/
│                   └── FbAssignmentRepository.ts  # Implementação Firestore
│
├── lib/                              # Output compilado (gerado por yarn build)
├── package.json
├── tsconfig.json
├── firebase.json
├── Dockerfile
├── docker-compose.yml
├── firestore.rules                   # Regras de segurança Firestore (usadas pelo emulator)
├── firestore.indexes.json            # Índices compostos do Firestore
├── secrets/                          # Ignorado pelo git
│   └── service_account.json
└── .infra/
    └── buildspec.yml                 # CI/CD AWS CodeBuild
```

---

## Fila de prioridade

O motor seleciona o próximo ticket em **4 camadas**, em ordem de prioridade:

| Camada | Condição | Agente elegível |
|---|---|---|
| 1 | `pending` + `pending_type = 'pendingAG2'`, mais antigo primeiro | AG2 apenas |
| 2 | `pending` + `pending_type = 'pendingShopper'`, mais antigo primeiro | AG2 apenas |
| 3 | `pending` + `pending_type = 'pendingClient'` + `new_messages_count > 0` | Qualquer |
| 4 | `open` → `priority DESC`, depois `opened_at ASC` (FIFO) | Qualquer |

---

## Estados do agente

| `availableAt` | `inAttendanceAt` | `waitingForNewTicket` | Estado |
|---|---|---|---|
| `0` | — | — | Offline |
| `≠ 0` | `0` | `0` | Fase 1 — busca ativa (gerenciada pelo cliente) |
| `≠ 0` | `0` | `≠ 0` | **Fase 2 — fila passiva (motor age aqui)** |
| `≠ 0` | `≠ 0` | `0` | Em atendimento |
| `≠ 0` | `0` | `≠ 0` + heartbeat stale | Zumbi — ignorado pelo motor |

---

## Pré-requisitos

- Node.js `20`
- Yarn `1.x`
- Docker + Docker Compose (para rodar localmente via container)
- Firebase CLI `14.1.0` (instalado automaticamente no Docker)
- Acesso ao projeto Firebase da Shopper
- Service account JSON com permissão de leitura/escrita no Firestore

---

## Instalação

```bash
git clone git@github.com:shopperti/ticket-assigner.git
cd ticket-assigner
yarn install
```

---

## Variáveis de ambiente

Crie um arquivo `.env` na raiz (já está no `.gitignore`):

```env
# Caminho para o service account — relativo à raiz do projeto
WHATSAPP_SERVICE_ACCOUNT=secrets/service_account.json

# ID do projeto Firebase (staging ou produção)
FB_PROJECT_ID=seu-projeto-firebase

# Token de deploy do Firebase CLI — necessário apenas em CI/CD
# Gere com: firebase login:ci
FB_DEPLOY_TOKEN=
```

### Service account

1. Acesse o [Console do Firebase](https://console.firebase.google.com) → **Configurações do projeto → Contas de serviço**
2. Clique em **Gerar nova chave privada**
3. Salve o JSON em `secrets/service_account.json`

> A pasta `secrets/` está no `.gitignore` e nunca deve ser commitada.

---

## Rodando localmente

O ambiente local usa dois containers via Docker Compose:

- **`functions`** — compila o TypeScript em modo watch; qualquer alteração em `functions/` é recompilada automaticamente
- **`emulators`** — Firebase Emulator Suite (Functions + Firestore + Pub/Sub)

```bash
# Primeira vez ou após mudar dependências
docker compose --profile dev up --build

# Demais vezes
docker compose --profile dev up
```

### Endereços

| Serviço | URL |
|---|---|
| Emulator UI | http://localhost:4000 |
| Functions | http://localhost:5001 |
| Firestore | localhost:8080 |
| Pub/Sub | localhost:8085 |

### Parar

```bash
docker compose --profile dev down
```

---

## Build e deploy

### Build local

```bash
yarn build        # compila TypeScript → lib/
yarn watch        # compila em modo watch
```

### Deploy manual

```bash
yarn deploy
# equivale a: firebase deploy --only functions:ticket-assigner
```

O deploy usa a **codebase** `ticket-assigner` configurada no `firebase.json`, o que garante que apenas as functions deste repositório são gerenciadas — functions de outros projetos no mesmo Firebase não são afetadas.

### Deploy via Docker (homolog)

```bash
docker compose --profile deploy up
```

Constrói a imagem de produção, compila o TypeScript e executa o deploy. As variáveis `FB_PROJECT_ID` e `FB_DEPLOY_TOKEN` devem estar no `.env`.

### Deploy via CI/CD (AWS CodeBuild)

O pipeline é configurado em `.infra/buildspec.yml`. As variáveis `FB_PROJECT_ID` e `FB_DEPLOY_TOKEN` devem estar configuradas como secrets no ambiente de build.

---

## Adicionando um novo canal

1. Crie `implementation/channels/<nome>/config.ts`:

```ts
import { IChannelConfig } from '../../../domain/models/IChannelConfig'

export const meuCanalConfig: IChannelConfig = {
  channel:             'meu-canal',
  queueCollection:     'meu_canal_cs_queue',
  ticketsCollection:   'meu_canal_tickets',
  pendingTypesAG2Only: ['pendingAG2'],
}
```

2. Crie `implementation/channels/<nome>/di.ts`:

```ts
import { container } from 'tsyringe'
import { IChannelConfig } from '../../../domain/models/IChannelConfig'
import { IAssignmentRepository } from '../../../domain/repositories/IAssignmentRepository'
import { FbAssignmentRepository } from '../../database/firebase/repositories/FbAssignmentRepository'
import { AssignTicketUseCase } from '../../../domain/usecases/AssignTicketUseCase'
import { ReconcileAssignmentsUseCase } from '../../../domain/usecases/ReconcileAssignmentsUseCase'
import { meuCanalConfig } from './config'

const meuCanalContainer = container.createChildContainer()
meuCanalContainer.registerInstance<IChannelConfig>('ChannelConfig', meuCanalConfig)
meuCanalContainer.register<IAssignmentRepository>('AssignmentRepository', { useClass: FbAssignmentRepository })

export const meuCanalAssign    = meuCanalContainer.resolve(AssignTicketUseCase)
export const meuCanalReconcile = meuCanalContainer.resolve(ReconcileAssignmentsUseCase)
```

3. Em `index.ts`, inclua o canal no `onAgentAvailable` e no reconciler:

```ts
import { meuCanalAssign, meuCanalReconcile } from './implementation/channels/meu-canal/di'

// onAgentAvailable — adicione ao encadeamento
const result = await whatsappAssign.byAgent(agentId)
  ?? await meuCanalAssign.byAgent(agentId)

// reconcileAssignments — adicione ao Promise.all
await Promise.all([
  whatsappReconcile.execute(),
  meuCanalReconcile.execute(),
])
```

Nenhum arquivo de domínio ou repositório precisa ser alterado.

---

## Testes

Recomendado usar os **emuladores do Firebase** para testes de integração.

### Cenários base

- **1 agente + 2 tickets** — apenas 1 atribuído; o segundo aguarda o agente encerrar
- **2 agentes + 1 ticket** — apenas 1 agente recebe; o outro segue em Fase 2
- **Corrida** — `onAgentAvailable` para o mesmo par simultaneamente → exatamente 1 atribuição
- **Reconciler** — ticket órfão sem trigger → atribuído em ≤ 1 min

### Cenários de papel (AG1/AG2)

- AG2 disponível + fila com `pendingAG2` e `open` → `pendingAG2` atribuído primeiro
- AG1 disponível + somente `pendingAG2` na fila → nenhuma atribuição
- `pendingClient` com `new_messages_count = 0` → não atribuído pela camada 3; cai na camada 4

### Cenários de heartbeat

- Agente com heartbeat stale (> 30s) → ignorado; próximo agente elegível recebe
- Todos os agentes stale → ticket fica na fila; reconciler também ignora
- Mais de 10 agentes stale à frente → nenhum encontrado; ticket aguarda próximo ciclo
