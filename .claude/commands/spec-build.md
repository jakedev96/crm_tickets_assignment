# Skill: spec-build

Guia de implementação a partir de uma spec SDD. Use junto com `/dev`. Receba o `id` da spec como argumento (ex: `/spec-build agent-response-suggester-v1`).

---

## Antes de escrever qualquer código

1. Leia `specs/<id>.yaml` integralmente.
2. Confirme que `status: approved`. Se for `draft`, pare e informe — não implemente.
3. Mapeie mentalmente os arquivos que você pode tocar:
   - **Pode ler:** apenas os listados em `reads:`
   - **Pode criar ou modificar:** apenas os listados em `writes:`
   - Qualquer outro arquivo é fora de escopo, mesmo que pareça relevante.

---

## Durante a implementação

**Error cases:** cada entrada em `error_cases` da spec é obrigatória. Implemente tratamento explícito para todos — não omita nenhum, não agrupe casos distintos.

**Env vars:** variáveis listadas em `env_vars` devem ser validadas no **cold start** (topo do módulo ou inicialização), nunca dentro do handler da CF.

**Debounce:** se a spec tiver seção `debounce`, implemente o mecanismo exatamente como descrito — `poll_interval_seconds`, `max_cycles` e a lógica de claim/abort são contratos, não sugestões.

**Firestore paths:** escreva apenas nos paths listados em `firestorePaths.writes`. Não introduza paths extras.

---

## Commit

Siga exatamente o formato em `commit_convention` da spec, incluindo a linha `spec: <id>` no corpo. Não use mensagem livre.
