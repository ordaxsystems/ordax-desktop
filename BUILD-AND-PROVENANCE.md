# OrdaX Desktop — build e proveniência canônicos

## Autoridades

- **Electron e NSIS:** `ordaxsystems/ordax-desktop` (este repositório).
- **Sistema e serviços Native:** `ordaxsystems/ordax-os`, pelo commit `os_sha`.
- **Surface:** revisão fixada exclusivamente no lock
  `ordax-os/docs/contracts/surface-source.json`.
- **Runtime MCP / Capability Fabric:** seus respectivos owners; nenhuma
  implementação é copiada para o Electron.

## Único produtor

A CI `.github/workflows/desktop-source.yml` valida este repositório e chama
o workflow reutilizável do OS
`ordax-os/.github/workflows/windows-desktop-dev.yml`, no commit
`3e7c907b11199c5a7e55f54df57268836f0c3eb5`. A chamada fornece `os_sha` e `desktop_sha` exatos.

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
Isso não autoriza assinatura Stable, substituição do Desktop operacional,
nem integração da [PR OS #2403](https://github.com/ordaxsystems/ordax-os/pull/2403)
enquanto o gate Creator continuar reprovado na
[issue #1935](https://github.com/ordaxsystems/ordax-os/issues/1935).

Histórico de importação: `docs/source-import.json`. O produtor de
migração `owner-export` foi desativado após a importação; a evidência
permanece no histórico Git, sem código de extração paralelo.

## Prova de atualização entre instaladores

O workflow manual `.github/workflows/desktop-cross-version-proof.yml` é **somente de validação**. Ele baixa os artefatos NSIS já compilados dos runs históricos do OS e do novo Desktop, exige ambos SHAs Git e os SHA-256 dos executáveis, e testa em runner Windows descartável: instalação do OS antigo → upgrade para Desktop → rollback. Não existe outro produtor, não há rebuild, nem execução no desktop pessoal. O teste falha fechado se não puder ler o artefato histórico ou verificar sua proveniência; não troca certificados nem publica Stable.
