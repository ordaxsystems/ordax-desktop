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

O build e o smoke NSIS foram aprovados com a fonte Desktop separada, mas
**cross-version upgrade e rollback NSIS** devem ser comprovados com
instaladores anteriores em Windows descartável antes de substituir uma
instalação de usuário ou anunciar corte Stable.

Histórico de importação: `docs/source-import.json`. O produtor de
migração `owner-export` foi desativado após a importação; a evidência
permanece no histórico Git, sem código de extração paralelo.
