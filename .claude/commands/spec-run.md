# Skill: spec-run

Executa o swarm SDD completo para uma spec. Receba o `id` da spec como argumento (ex: `/spec-run agent-response-suggester-v1`).

Use o Workflow tool com o script abaixo, substituindo `SPEC_ID` pelo argumento recebido.

---

```javascript
export const meta = {
  name: 'spec-run',
  description: 'Swarm SDD: Scout → Builders → Wirer → Verifier → Tester',
  phases: [
    { title: 'Scout',    detail: 'lê arquivos de referência da spec' },
    { title: 'Build',    detail: 'domain, use case e implementação em paralelo' },
    { title: 'Wire',     detail: 'trigger + re-export' },
    { title: 'Verify',   detail: 'verificação adversarial de spec compliance' },
    { title: 'Test',     detail: 'gera e executa testes unitários da spec' },
  ],
}

const SPEC_ID = args

// ── Phase 1: Scout ────────────────────────────────────────────
phase('Scout')

const context = await agent(
  `Você é o Scout do swarm SDD.

  1. Leia o arquivo specs/${SPEC_ID}.yaml integralmente.
  2. Leia todos os arquivos listados em reads: da spec.
  3. Retorne um objeto JSON com:
     {
       "spec": <conteúdo completo da spec como objeto>,
       "referenceFiles": { "<caminho>": "<conteúdo>" }
     }

  Retorne apenas o JSON, sem texto adicional.`,
  { label: 'scout', phase: 'Scout', agentType: 'Explore', model: 'haiku', effort: 'low' }
)

// ── Phase 2: Builders (paralelo) ──────────────────────────────
phase('Build')

const CONTEXT_BLOCK = `
## Spec
\`\`\`yaml
${JSON.stringify(context)}
\`\`\`

Antes de implementar:
- Invoque a skill /dev
- Invoque a skill /spec-build ${SPEC_ID}
`

const jsonMatch = context.match(/\{[\s\S]*\}/)
const specData = JSON.parse(jsonMatch ? jsonMatch[0] : context)
const writes = specData.spec.writes

const domainWrites   = writes.filter(f => f.includes('domain/models') || f.includes('domain/repositories'))
const usecaseWrites  = writes.filter(f => f.includes('domain/usecases'))
const implWrites     = writes.filter(f => f.includes('implementation/'))

await parallel([
  () => agent(
    `Você é o Builder-Domain do swarm SDD para a spec ${SPEC_ID}.

    ${CONTEXT_BLOCK}

    Implemente os seguintes arquivos:
    ${domainWrites.map(f => `- ${f}`).join('\n')}

    Escreva apenas interfaces e modelos puros. Nenhum import de firebase-admin, tsyringe ou implementation/.`,
    { label: 'builder-domain', phase: 'Build', model: 'haiku', effort: 'low' }
  ),
  () => agent(
    `Você é o Builder-UseCase do swarm SDD para a spec ${SPEC_ID}.

    ${CONTEXT_BLOCK}

    Implemente os seguintes arquivos:
    ${usecaseWrites.map(f => `- ${f}`).join('\n')}

    Implemente todos os error_cases e o mecanismo de debounce exatamente como descrito na spec.
    Nenhum import de firebase-admin ou implementation/ — dependa apenas de interfaces.
    Seja direto. Não explique o que fez, não adicione comentários sobre sua abordagem.`,
    { label: 'builder-usecase', phase: 'Build' }
  ),
  () => agent(
    `Você é o Builder-Impl do swarm SDD para a spec ${SPEC_ID}.

    ${CONTEXT_BLOCK}

    Implemente os seguintes arquivos:
    ${implWrites.map(f => `- ${f}`).join('\n')}

    Implemente as queries e escritas Firestore. Siga os padrões de transação do /dev.
    Seja direto. Não explique o que fez, não adicione comentários sobre sua abordagem.`,
    { label: 'builder-impl', phase: 'Build' }
  ),
])

// ── Phase 3: Wirer ────────────────────────────────────────────
phase('Wire')

const triggerWrites = writes.filter(f => f.includes('/index.ts'))

await agent(
  `Você é o Wirer do swarm SDD para a spec ${SPEC_ID}.

  ${CONTEXT_BLOCK}

  Os arquivos de domínio e implementação já foram criados pelos builders.
  Implemente agora:
  ${triggerWrites.map(f => `- ${f}`).join('\n')}

  Leia os arquivos criados pelos builders antes de escrever o trigger.
  Siga o commit_convention da spec para o commit final.`,
  { label: 'wirer', phase: 'Wire', model: 'haiku', effort: 'low' }
)

// ── Phase 4: Verifier ─────────────────────────────────────────
phase('Verify')

const verifyResult = await agent(
  `Você é o Verifier adversarial do swarm SDD.

  Invoque a skill /spec-verify ${SPEC_ID}

  Retorne o resultado completo da verificação com RESULT: APPROVED ou REJECTED.
  Seja direto. Não explique o que fez, não adicione comentários sobre sua abordagem.`,
  { label: 'verifier', phase: 'Verify' }
)

// ── Phase 5: Tester ───────────────────────────────────────────
phase('Test')

const testResult = await agent(
  `Você é o Tester do swarm SDD para a spec ${SPEC_ID}.

  Invoque a skill /spec-test ${SPEC_ID}

  Retorne o resultado completo com TESTS: PASSED ou FAILED.
  Seja direto. Não explique o que fez, não adicione comentários sobre sua abordagem.`,
  { label: 'tester', phase: 'Test' }
)

return `## Verify\n${verifyResult}\n\n## Test\n${testResult}`
```
