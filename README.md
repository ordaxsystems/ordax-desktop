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
O instalador permanece **Dev unsigned**. A prova de instalação, upgrade e
rollback entre versões foi aprovada em Windows descartável na
[cross-version #41786352134](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41786352134),
com `OS_TO_DESKTOP_NSIS_UPGRADE=PASS` e `DESKTOP_TO_OS_NSIS_ROLLBACK=PASS`.
A revisão `dfb43db3` também concluiu contratos, NSIS, smoke de instalação
e publicação do artefato na [CI #41797193969](https://github.com/ordaxsystems/ordax-desktop/actions/runs/41797193969).
Essas provas **não** substituem homologação física da instalação operacional,
assinatura Stable nem o gate Creator da [PR OS #2403](https://github.com/ordaxsystems/ordax-os/pull/2403).

## Windows window layout (Electron owner)

The Desktop persists normal bounds and maximized state in the existing user
profile and restores them within the available display work areas. Hot-unplug,
RDP and display-metric changes recover windows that would otherwise be offscreen.
This functionality lives in `window-layout.cjs`, not in OS Native or Surface.
Run `node --test window-layout.test.cjs` for its focused regression tests.
