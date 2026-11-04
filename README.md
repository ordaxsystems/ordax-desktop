# OrdaX Desktop — Windows

**Fonte canônica única do host Electron Windows**: janelas, integração Native,
empacotamento NSIS e atualização de desenvolvimento. A interface Surface, o
kernel, os serviços Native, a identidade, o MCP e os modelos pertencem aos
respectivos repositórios do ecossistema OrdaX.

A importação foi auditada byte a byte contra `ordax-os` commit `526b0e46`.
[docs/source-import.json](docs/source-import.json) preserva a proveniência
histórica; não autoriza uma segunda implementação.

## Build e testes

- Desenvolvimento: [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md).
- Build, origem e segurança: [BUILD-AND-PROVENANCE.md](BUILD-AND-PROVENANCE.md).
- Testes portáveis: `npm test` (sem compilar kernel, Buildroot ou instalador).

A CI privada `Desktop Source Contracts` valida a fonte e chama um **único**
produtor Windows do `ordax-os`, pinado por commit exato
`3e7c907b11199c5a7e55f54df57268836f0c3eb5`. O OS continua autoridade dos recursos Native e do lock da Surface;
o Electron é obtido exclusivamente deste repositório. A proveniência instalada
registra ambos os SHAs.

A antiga árvore `tools/windows-desktop/` foi retirada da
[PR #2403](https://github.com/ordaxsystems/ordax-os/pull/2403) do OS;
nenhum segundo pipeline ou código Electron em uso deve permanecer no OS.
O instalador é **Dev unsigned**, não um Stable autorizado. A migração da
instalação de um release anterior e o rollback NSIS ainda exigem validação
em ambiente isolado antes de distribuição ou substituição do Desktop em uso.
