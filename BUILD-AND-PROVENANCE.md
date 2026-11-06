# OrdaX Desktop — build e proveniência canônicos

## Autoridades

- **Electron e NSIS:** `ordaxsystems/ordax-desktop` (este repositório).
- **Sistema e serviços Native:** `ordaxsystems/ordax-os`, pelo commit `os_sha`.
- **Surface:** revisão fixada exclusivamente no lock
  `ordax-os/docs/contracts/surface-source.json`.
- **Runtime MCP / Capability Fabric:** seus respectivos owners; nenhuma
  implementação é copiada para o Electron.

## Estado integrado e staging com owner único (05/11/2026)

As PRs Desktop [#6](https://github.com/ordaxsystems/ordax-desktop/pull/6),
[#7](https://github.com/ordaxsystems/ordax-desktop/pull/7) e
[#8](https://github.com/ordaxsystems/ordax-desktop/pull/8) estão integradas;
os gates Windows/NSIS mais recentes estão verdes. A instalação canônica no
Windows físico recebeu o delta transacional da PR #7 e comprovou boot da
Surface, encerramento completo do filho Native e relançamento saudável.

`standalone-stage.cjs` aceita **somente** a composição com dois checkouts Git
exatos, limpos e identificados: `--os-root`/`os_sha` para os serviços Native e
`--desktop-root`/`desktop_sha` para a shell Electron. O modo de um argumento
que obtinha o Electron de `ordax-os/tools/windows-desktop` foi removido.
`verifyStandaloneStage` recusa recibo sem `desktop_owner` e
`desktop_sha`, ou que declare `ordax-os` como proprietário da shell.
Os paths relativos dos recursos continuam resolvidos contra um **anchor
virtual** na hierarquia OS — sem pasta/implementação Electron correspondente.

O único uso permitido de recibos OS-owned antigos é a prova histórica de
upgrade/rollback em `ci/windows-cross-version-smoke.ps1`; jamais o produtor
ou o smoke NSIS de novos artefatos. A exclusão da árvore legada da `main`
do OS é responsabilidade da PR `ordax-os#2403`, não deste repositório.

## Atualização Dev por impacto real

O materializador Git de `dev-update.cjs` é o **único owner Windows**
da classificação de revisões da `ordax-os/main`. Antes de compilar,
compara as revisões Git exatas desde a última versão Native saudável
(ou desde o bundle instalado cujo SHA e bytes tenham sido verificados).
Apenas arquivos explicitamente não-runtime — documentação sem contratos/
evidências, testes, governança CI e o script Linux `ordax-pull` — podem
dispensar o build Windows. Alterações em `system/`, contratos Native,
Surface, bridge Web, emulador ou caminhos desconhecidos sempre seguem
o ciclo normal de build, prova de saúde e rollback.

O campo `nonRuntimeMainSha` em
`desktop-dev-update-state.json` memoriza a última revisão `main` já
comprovada sem impacto para evitar clonar o mesmo commit a cada minuto.
**Não é um SHA ativado nem nova autoridade de distribuição**: o
`activeSha` e seu recibo de build continuam sendo a verdade operacional.
Ao surgir código Native, a comparação volta ao `activeSha` original;
quando há alteração de versão saudável, o marcador não-runtime é limpo.
O diff Git precisa ser completo, delimitado por NUL e limitado em bytes;
erros, truncamento e donos não previstos exigem validação normal.

## Encerramento Native e Supervisor no owner correto

O Electron deste repositório é dono do ciclo de vida da janela e da chamada
`stopHost(child, template)`, não da política de encerramento de processos
Windows. A árvore real do Native/Product é encerrada através do módulo
**único** `ordax-os/system/adapters/desktop/owned-process-tree.cjs` contido
na distribuição Native verificada. O fechamento espera o término da árvore
antes de o Electron sair, evitando órfãos do Product Runtime. Uma revisão
antiga sem esse módulo só pode sinalizar o PID filho exato, nunca procurar
processos por nome. Filhos já encerrados nunca podem ser sinalizados.

O launcher `dev:local` habilita o Supervisor Native existente somente no
perfil de desenvolvimento, sem criar agente Electron ou contornar as
autoridades Runtime/Platform. O smoke NSIS comprova que os módulos de
Supervisor e os contratos de estado da Surface realmente acompanham o OS
embutido. O histórico da migração não autoriza reimportar
`tools/windows-desktop/` do repositório OS: alterações válidas daquela
árvore precisam ser conciliadas neste owner antes da exclusão canônica pela
PR `ordax-os#2403`.

## Único produtor

A CI `.github/workflows/desktop-source.yml` valida este repositório e chama
o workflow reutilizável do OS
`ordax-os/.github/workflows/windows-desktop-dev.yml`, com a interface
`workflow_call` fixada em `3e7c907b11199c5a7e55f54df57268836f0c3eb5`.
Essa referência é a versão compatível do produtor reutilizável, **não** a
revisão Native empacotada: `os_sha` aponta separadamente para
`352782a04c0ea48e33df139199e80898532d60d0` (OS main com Surface #93), e `desktop_sha` para o
commit exato deste repositório. A versão atual do workflow do OS não
expõe `workflow_call`; apontar `uses` diretamente para ela quebraria a CI.
Atualizar `os_sha` exige nova prova NSIS, sem criar outro produtor.

O produtor verifica ambos os checkouts Git, compara os bytes do Electron aos
objetos Git, monta os recursos Native a partir do OS, reatesta os recibos
compilados e emite o mesmo manifesto dentro do NSIS. Um diretório
`out/ordax-desktop-source` é **temporário e ignorado**, não uma segunda
implementação no repositório OS. Não há segundo compilador Windows.

O artefato de CI é **Dev unsigned** e não deve ser confundido com um release
Stable assinado. Não altere appId, canal de atualização ou grants para
contornar gates.

## Gates de liberação

O build e o smoke NSIS foram aprovados com fonte Desktop separada na
[CI #41797193969](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41797193969)
(commit `dfb43db3`). A prova **cross-version** já foi aprovada na
[CI #41786352134](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41786352134):
`OS_TO_DESKTOP_NSIS_UPGRADE=PASS` e `DESKTOP_TO_OS_NSIS_ROLLBACK=PASS`,
com hashes dos instaladores conferidos em Windows descartável. Os 34 testes
portáteis da fonte Desktop passaram também no `DESKTOP-4UFL03B`.
Essas provas históricas não autorizam assinatura Stable nem garantem que
um NSIS anterior contenha os módulos Native Product integrados depois.
A CI mais recente do Desktop antes do novo pin, [#41934791675](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41934791675),
passou para `desktop_sha=249306fa`, mas ainda empacotava o `os_sha` antigo.
A entrega com o novo `os_sha` só é homologada após CI e smoke NSIS próprios.

**Histórico de gate posteriormente resolvido (04/11/2026, 21h34 BRT):** a CI
[#41939483362](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41939483362)
tentou o NSIS com `os_sha=4916cf91`, mas falhou nos testes de contrato da
fonte Desktop. A [PR #5](https://github.com/ordaxsystems/ordax-desktop/pull/5)
reconciliou esses testes; a CI
[#41942309250](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41942309250)
passou na validação de fonte, **mas dispensou o job NSIS** por impacto.
A execução manual oficial [#41946874405](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41946874405)
executou o gate NSIS com o pin Native correto, mas parou no teste de fonte
`runtime.test.cjs`: a expectativa textual ainda apontava para o caminho antigo
`tools/windows-desktop/dev-update-real-build.test.cjs`, embora o **único**
smoke canônico do Desktop chame a prova já existente em
`out/ordax-desktop-source/dev-update-real-build.test.cjs`.
A correção mantém o mesmo teste físico read-only e verifica uma invocação
única, sem reinstalar agentes, duplicar código nem dispensar a verificação.
Essa tentativa histórica foi superada pelas CIs
[#42029571439](https://github.com/ordaxsystems/ordax-desktop/actions/runs/42029571439)
e [#42036239479](https://github.com/ordaxsystems/ordax-desktop/actions/runs/42036239479),
ambas aprovadas nos dois gates de fonte e instalador NSIS. A homologação
física da atualização Dev e do encerramento da árvore Native está registrada
na PR Desktop #7. O canal continua **Dev unsigned**, não Stable.

**Bloqueio independente do Product:** a
[issue Runtime #327](https://github.com/ordaxsystems/ordax-runtime/issues/327)
identifica risco de `machine_binding` do Product coincidir com o MCP auxiliar.
A matrícula Owner OAuth/PKCE fica bloqueada até o owner Runtime corrigir a
vinculação e o owner Platform confirmar a identidade existente. O status
operacional e os gates Product continuam tendo como SSOT o
`ordax-os/docs/CURRENT-STATE.md`, sem replicar cadastro ou credenciais aqui.

**SSOT Product:** a autoridade da inscrição, do binário e dos grants fica em
`ordax-os/docs/CURRENT-STATE.md`, na política
`ordax-os/docs/contracts/runtime-component-trust-policy.json` e na evidência
`ordax-os/docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json`.
Uma prova de executável DEV offline não concede autorização de instalação;
respeitar `installation_authorized_by_candidate` e os gates de assinatura.
A shell Electron não copia agentes, credenciais nem capacidades do MCP auxiliar.
O recibo de Surface saudável não comprova `mcpReady` do Product.

Histórico de importação: `docs/source-import.json`. O produtor de
migração `owner-export` foi desativado após a importação; a evidência
permanece no histórico Git, sem código de extração paralelo.

## Prova de atualização entre instaladores

O workflow manual `.github/workflows/desktop-cross-version-proof.yml` é **somente de validação**. Ele baixa os artefatos NSIS já compilados dos runs históricos do OS e do novo Desktop, exige ambos SHAs Git e os SHA-256 dos executáveis, e testa em runner Windows descartável: instalação do OS antigo → upgrade para Desktop → rollback. Não existe outro produtor, não há rebuild, nem execução no desktop pessoal. O teste falha fechado se não puder ler o artefato histórico ou verificar sua proveniência; não troca certificados nem publica Stable.
