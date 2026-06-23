# CLAUDE.md

## Visão Geral

Firebase Cloud Functions em TypeScript que implementam lógica de negócio orientada a eventos sobre Firestore. O projeto segue Clean Architecture com inversão de dependência e suporte nativo a múltiplos canais. Toda feature nova começa com uma especificação em `specs/` — este projeto adota **SDD (Specification-Driven Development)**.

---

## Harness do Projeto

### Comandos principais

```bash
yarn build          # compila TypeScript → lib/
yarn watch          # compilação incremental
yarn deploy         # firebase deploy --only functions:<nome-do-projeto>
yarn test           # roda todos os testes unitários
yarn test:watch     # testes em modo watch
yarn test:coverage  # cobertura de código
```

### Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Firebase Cloud Functions v2 (Node.js) |
| Banco de dados | Firestore (firebase-admin) |
| DI | tsyringe |
| Linguagem | TypeScript 5 |
| Testes | Jest + ts-jest |
| Infra CI | AWS CodeBuild (`.infra/buildspec.yml`) |

---

## SDD — Specification-Driven Development

**Todo novo comportamento começa com uma spec.** Nenhum código é escrito sem spec aprovada.

### Fluxo obrigatório

```
1. SPEC   →  escrever specs/<feature>-v<n>.yaml
2. REVIEW →  validar contrato, reads/writes, error_cases, test_scenarios
3. BUILD  →  implementar SOMENTE os arquivos listados em writes:
4. TEST   →  /spec-test <id> — gera tests/usecases/<feature>.test.ts e executa
5. COMMIT →  usar o commit_convention da spec
```

### Formato de spec (`specs/<feature>-v<n>.yaml`)

```yaml
id: <feature>-v<n>
status: draft | approved | implemented
feature: <nome-kebab-case>
firebase_app: default | <app-name>   # app Firebase que a CF usa

trigger:
  type: onDocumentCreated | onDocumentWritten | onSchedule | onCall
  collection: <path>/{param}/...     # omitir para onSchedule/onCall
  options:
    timeoutSeconds: <n>
    memory: <256MiB|512MiB|1GiB>
    region: us-central1

# Incluir apenas se a CF precisar de debounce/lock distribuído
debounce:
  lock_field: <campoNoFirestore>
  mechanism: |
    1. ...
  poll_interval_seconds: <n>
  max_cycles: <n>

contract:
  input:
    <campo>: <tipo>     # campos extraídos do trigger ou payload
  output:
    <campo>: <tipo>     # o que a CF produz / salva

reads:                  # arquivos que o agente BUILD pode LER (somente esses)
  - <caminho relativo>

writes:                 # arquivos que o agente BUILD pode CRIAR ou MODIFICAR
  - <caminho relativo>

firestorePaths:
  reads:
    - <collection>/{param}
  writes:
    - <collection>/{param}.<campo>

env_vars:
  - NOME_DA_VAR     # descreva o propósito no comentário inline

endpoint:             # incluir apenas se a CF chamar HTTP externo
  method: POST | GET
  url: "env:NOME_VAR"
  auth: "Bearer env:NOME_KEY"
  body:
    <campo>: <tipo>
  response_saved_to: "<collection>/{param}.<campo>"

idempotency: |
  <descrever garantia de idempotência>

error_cases:
  NOME_DO_ERRO: >
    <condição> → <ação>. Log: "<prefixo> mensagem".

test_scenarios:
  - "<cenário em linguagem natural>"

commit_convention: |
  feat(<feature>): <descrição curta>

  spec: <id-da-spec>
```

### Regras SDD

- `status: draft` → spec em discussão, não implementar
- `status: approved` → pode implementar
- `status: implemented` → não alterar sem criar `v<n+1>`
- O agente BUILD só pode tocar arquivos listados em `reads:` e `writes:` da spec
- Arquivos de domínio existentes **não são modificados** por specs novas — apenas novos arquivos de domínio são criados
- Ao implementar, referenciar a spec no commit exatamente como em `commit_convention`

---

## Arquitetura

```
functions/
  index.ts                          ← re-export de todos os triggers
  <canal>/index.ts                  ← triggers do canal (onDocumentWritten, onSchedule…)
  domain/
    models/                         ← interfaces puras (sem deps externas)
      IChannelConfig.ts
      channels/<canal>/
    repositories/                   ← portas (interfaces)
    usecases/                       ← regras de negócio
  implementation/
    channels/<canal>/
      config.ts                     ← IChannelConfig do canal
      di.ts                         ← child container tsyringe
    database/<canal>-firebase/
      firebase.ts                   ← instância do Firestore
      repositories/                 ← implementações concretas
lib/                                ← output do tsc (não editar)
specs/                              ← especificações SDD
```

### Hierarquia de dependências (sentido único)

```
triggers → usecases → repositories (interfaces) ← implementation
```

**`domain/` jamais importa de `implementation/`, `firebase-admin` ou `tsyringe`.**

---

## Princípios de código

**SOLID no projeto:**

- **S** — Um use case, uma responsabilidade. Se crescer, extraia método privado ou novo use case.
- **O** — Novos canais não modificam domínio existente. Extensão via `IChannelConfig` + child container.
- **L** — Qualquer `IAssignmentRepository` substitui `FbAssignmentRepository` sem quebrar use cases.
- **I** — Interfaces expostas com apenas os métodos necessários. Não adicione métodos de implementação específica.
- **D** — Use cases dependem de interfaces. Toda dependência injetada via `@inject()`, nunca `new` interno.

**Transações Firestore:**

- Todas as leituras (`tx.get()`) ANTES de qualquer escrita (`tx.update()` / `tx.set()`)
- Revalidar estado dentro da transação antes do commit
- Nunca ler fora e escrever dentro sem reler

**Imports:**

- `import type` para tipos usados apenas como anotação

**Comentários:**

- Apenas quando o *porquê* não é óbvio (restrição oculta, invariante sutil, workaround)
- Nunca descrever o que o código faz

---

## Adicionando um novo canal

1. `implementation/channels/<nome>/config.ts` — implementar `IChannelConfig`
2. `implementation/channels/<nome>/di.ts` — child container tsyringe
3. `functions/<nome>/index.ts` — triggers do canal
4. `functions/index.ts` — adicionar re-export
5. **Nenhum arquivo de domínio existente é alterado**

---

## O que não fazer

- Não instanciar repositórios com `new` — sempre via container
- Não colocar lógica de Firestore em use cases ou models
- Não criar abstrações para cenários hipotéticos
- Não adicionar tratamento de erro para caminhos impossíveis
- Não implementar sem spec aprovada em `specs/`
- Não modificar spec `implemented` — criar `v<n+1>`

---

## Pull Request

Usar o template em `pull_request_template.md`. Incluir link do ClickUp quando houver tarefa associada.
