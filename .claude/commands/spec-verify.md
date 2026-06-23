# Skill: spec-verify

Verificação adversarial de uma implementação SDD. Sua função é tentar **refutar** que o código está correto e compliant com a spec. Não valide — tente falsificar.

Receba o `id` da spec como argumento (ex: `/spec-verify agent-response-suggester-v1`) e execute os passos abaixo em ordem.

---

## 1. Carregar a spec

Leia `specs/<id>.yaml`. Se não existir, pare e reporte erro.

Extraia e mantenha em mente:
- `writes:` — lista exata de arquivos que a implementação pode ter tocado
- `reads:` — lista exata de arquivos de referência (não devem ter sido modificados)
- `error_cases` — cada caso com nome e comportamento esperado
- `test_scenarios` — cada cenário em linguagem natural
- `firestorePaths.writes` — campos que devem ser escritos
- `env_vars` — variáveis que devem ser validadas no cold start
- `debounce` — se presente, o mecanismo de lock distribuído
- `contract.output` — o que a CF deve produzir

---

## 2. Boundary de arquivos

**Leia o git diff ou liste os arquivos criados/modificados desde o início da implementação.**

Verifique:
- [ ] Todos os arquivos tocados estão em `writes:` da spec?
- [ ] Algum arquivo de `reads:` foi modificado? (proibido — são somente referência)
- [ ] Algum arquivo de domínio existente fora de `writes:` foi alterado?

Reporte qualquer violação como **BOUNDARY_VIOLATION**.

---

## 3. Error cases

Para cada entrada em `error_cases`, leia o UseCase e o repositório e verifique:

- [ ] O caso tem tratamento explícito no código (não apenas comentário)?
- [ ] O log segue o prefixo definido na spec?
- [ ] A ação descrita (abortar, liberar lock, não salvar, falhar no cold start) está implementada?

Checagens específicas de padrão:

- **MISSING_ENV**: a validação ocorre no módulo de inicialização ou no topo do arquivo de trigger — não dentro do handler da CF. Se estiver dentro do handler, é **MISSING_ENV_RUNTIME** (falha silenciosa em produção).
- **LOCK_LOST**: o abort é silencioso? Não deve lançar exceção — apenas retornar/parar o ciclo.
- **ENDPOINT_ERROR**: o lock (`agentSuggestionJobId` ou equivalente) é explicitamente nulificado após erro HTTP?
- **NO_MESSAGES**: o endpoint **não** é chamado? O lock é liberado?

---

## 4. Test scenarios

Para cada item em `test_scenarios`, trace o caminho de execução no código e responda:

- [ ] O cenário é satisfazível pelo código implementado?
- [ ] Existe algum caminho no código que produziria comportamento diferente do descrito?

Se um cenário não for satisfazível, reporte como **SCENARIO_GAP** com o trecho de código responsável.

---

## 5. Firestore paths

Leia o repositório de implementação e verifique:

- [ ] Todos os `firestorePaths.writes` têm operação de escrita correspondente no código?
- [ ] Nenhum path não listado na spec está sendo escrito?

---

## 6. Consistência de tipos TypeScript

Leia todos os arquivos em `writes:` e verifique cruzadamente:

- [ ] Interfaces importadas batem com as definições? (ex: o UseCase importa a interface correta, não a implementação)
- [ ] `import type` é usado para tipos usados apenas como anotação?
- [ ] Algum arquivo importa de `implementation/` dentro de `domain/`? (**ARCH_VIOLATION**)

---

## 7. Debounce (se spec tiver seção `debounce`)

- [ ] O `poll_interval_seconds` está respeitado no código?
- [ ] O `max_cycles` limita o loop? Não pode ser loop infinito.
- [ ] O claim do lock ocorre **antes** do primeiro sleep?
- [ ] O lock é verificado **a cada ciclo**, não só ao final?
- [ ] Se o lock for perdido mid-cycle, o abort ocorre sem side effects?

---

## 8. Commit convention

- [ ] O commit mensage segue exatamente o formato em `commit_convention` da spec?
- [ ] A linha `spec: <id>` está presente no corpo do commit?

Se o commit ainda não foi feito, apenas registre como pendente.

---

## Formato de saída

Reporte cada achado no formato:

```
[PASS] ou [FAIL] — <categoria> — <descrição curta>
  → <arquivo>:<linha> se aplicável
  → <evidência ou trecho de código>
```

Ao final, emita um resumo:

```
RESULT: APPROVED | REJECTED
Fails: <n>
Warnings: <n>  (achados que merecem atenção mas não bloqueiam)
```

`REJECTED` se houver qualquer `[FAIL]`. `APPROVED` só se todos os checks forem `[PASS]` ou `WARNING`.
