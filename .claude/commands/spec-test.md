# Skill: spec-test

Gera e executa testes unitários para uma spec SDD aprovada ou implementada.

Receba o `id` da spec como argumento (ex: `/spec-test agent-response-suggester-v1`).

---

## Pré-condições

1. A spec `specs/<id>.yaml` deve existir com `status: approved` ou `status: implemented`. Se `draft`, pare e reporte erro.
2. Verifique que `node_modules/jest` existe. Se não, rode `yarn install` antes de prosseguir.

---

## 1. Ler a spec

Leia `specs/<id>.yaml`. Extraia:

- `feature` — nome kebab-case para nomear o arquivo de teste
- `writes:` — localize arquivos de use case (contêm `usecases/`)
- `reads:` — interfaces de repositório e modelos referenciados
- `test_scenarios` — cenários em linguagem natural
- `error_cases` — nome, condição e ação esperada de cada caso
- `contract.input` e `contract.output` — tipos para montar chamadas ao use case
- `debounce` — se presente, indica lógica de polling/lock a ser exercida nos testes
- `endpoint` — se presente, a chamada HTTP é encapsulada num repositório que deve ser mockado

---

## 2. Ler os arquivos relevantes

Leia todos os arquivos de use case encontrados em `writes:` (caminhos com `usecases/`).

Para cada use case, mapeie:
- Nome da classe exportada
- Parâmetros do constructor — tipo de cada interface injetada
- Método principal de execução (geralmente `execute(...)`)
- Quais métodos de cada repositório são chamados internamente

Leia também as interfaces de repositório (de `reads:` ou inferidas pelos imports do use case) para saber todos os métodos que o mock deve implementar.

---

## 3. Gerar o arquivo de teste

Escreva em `tests/usecases/<feature>.test.ts`.

### Estrutura obrigatória

```typescript
import 'reflect-metadata'
import { <UseCase> } from '../../functions/domain/usecases/<caminho>'
import type { <IRepo> } from '../../functions/domain/repositories/<caminho>'

function make<IRepo>(): jest.Mocked<IRepo> {
  return {
    methodA: jest.fn(),
    methodB: jest.fn(),
  }
}

describe('<UseCase>', () => {
  let useCase: <UseCase>
  let mockRepo: jest.Mocked<IRepo>

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepo = make<IRepo>()
    useCase = new <UseCase>(mockRepo)
  })

  // test_scenarios da spec — um it() por cenário
  it('<cenário em linguagem natural>', async () => {
    // Arrange
    mockRepo.findById.mockResolvedValue({ ... })

    // Act
    await useCase.execute({ ... })

    // Assert
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ ... }))
  })

  // error_cases da spec — um it() por caso de erro
  it('error: <NOME_DO_ERRO>', async () => {
    // Arrange: provocar a condição
    mockRepo.findById.mockResolvedValue(null)

    // Act
    await useCase.execute({ ... })

    // Assert: verificar a ação descrita na spec (não chamou endpoint, liberou lock, etc.)
    expect(mockRepo.save).not.toHaveBeenCalled()
  })
})
```

### Regras de geração

- `import 'reflect-metadata'` sempre primeiro
- Use `import type` para interfaces usadas apenas como anotação de tipo
- Instancie o use case com `new` — não use o container tsyringe
- `jest.clearAllMocks()` no `beforeEach`
- Para `error_cases`, o assert deve verificar a **ação** descrita (não apenas ausência de exceção)
- Para use cases com `debounce`: use `jest.useFakeTimers()` para controlar `setTimeout`/`setInterval`; chame `jest.runAllTimersAsync()` para avançar o polling
- Para chamadas HTTP (`endpoint` na spec): o repositório que encapsula a chamada é mockado — nunca mock fetch ou axios diretamente

---

## 4. Executar os testes

```bash
yarn test --testPathPattern=<feature>
```

Se falhar:
1. Leia o erro completo
2. Corrija o arquivo de teste (imports errados, tipos incorretos, mock incompleto)
3. Se encontrar um bug real no código de produção: reporte separadamente como **BUG_FOUND** — não altere o código de produção nesta skill
4. Execute novamente até todos os testes passarem

---

## 5. Reportar resultado

```
TESTS: PASSED | FAILED
Scenarios covered: <n>/<total de test_scenarios>
Error cases covered: <n>/<total de error_cases>
File: tests/usecases/<feature>.test.ts

[SKIP — <razão>]  ← se algum cenário requer integração real (Firebase, HTTP externo)
[BUG_FOUND] <descrição> → <arquivo>:<linha>  ← se encontrado
```
