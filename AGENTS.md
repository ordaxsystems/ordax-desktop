# Instruções para agentes — ordax-desktop

Este repositório conserva a autoridade dos seus próprios contratos, código e responsáveis. Não copiar componentes nem criar SSOT paralelo.

## Integração canônica no produto — 13/11/2026

`ordax-desktop` é o **host/empacotador Windows**. Sua dependência de produto é uma composição OrdaX/OS verificável, não uma lista independente de Surface/Apps/Intelligence/Runtime.

- Desktop fixa/consome a revisão direta de `ordax-os` usada pelo candidato Windows e registra sua provenance.
- A Surface usada por esse candidato já é selecionada pelo lock do OS; **não criar segundo pin da Surface no Desktop**.
- O build Windows pode materializar temporariamente a revisão **exata já escolhida pelo lock do OS** para reproduzir a composição (`surface-stage.cjs`); isso não cria dependência direta adicional nem autoriza lock/versão Surface própria no Desktop.
- Apps e Intelligence chegam pelos mecanismos/contratos da composição; não copiar source nem sincronizar HEADs.
- Uma mudança em Surface ou app não exige PR Desktop até existir intenção real de produzir/validar um novo candidato Windows.
- Mudanças apenas do host Electron/NSIS ficam neste repo e não disparam USB/kernel/Creator.
- Não documentar SHA histórico como versão operacional vigente; ler workflow/configuração/provenance atual.

Regra transversal: [`ordax-os/docs/DEVELOPMENT-WORKFLOW.md`](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13), ADR-031.

## Execução DEV — Evolução Rápida

Aplicar a [política transversal canônica do OrdaX](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#regra-operacional-transversal--evolucao-rapida-dev-2026-11-04): identificar o owner/arquivo afetado, executar diretamente a correção/implementação, integrar e só depois validar proporcionalmente ao impacto. Evitar pesquisas, testes, builds, novos workflows, documentação e PRs paralelas sem necessidade comprovada. `continue` significa avançar a entrega corrente, não reiniciar auditorias.

Gates de segurança, trust, permissões, proteção da `main`, integridade, operações destrutivas e promoção de release continuam obrigatórios quando aplicáveis. Respeitar os documentos e contratos locais; este arquivo é um encaminhamento da política de execução, não uma segunda autoridade técnica.
