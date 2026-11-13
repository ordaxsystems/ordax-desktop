# OrdaX Desktop — Windows

**Fonte canônica única do host Electron Windows**: janelas, integração Native,
empacotamento NSIS e atualização de desenvolvimento. A interface Surface, o
kernel, os serviços Native, a identidade, o MCP e os modelos pertencem aos
respectivos repositórios do ecossistema OrdaX.

A importação foi auditada byte a byte contra `ordax-os` commit `526b0e46`.
[docs/source-import.json](docs/source-import.json) preserva a proveniência
histórica; não autoriza uma segunda implementação.

## Integração com o produto OrdaX

Desktop empacota e hospeda no Windows **uma composição OrdaX/OS exata e verificável**. Ele não integra a Surface separadamente: a revisão visual já é escolhida pelo lock canônico do OS. O mesmo vale para dependências transitivas de Apps/Intelligence — o Desktop não mantém uma segunda árvore de pins.

Portanto, uma mudança visual pode ser concluída na Surface e adotada no OS sem alterar este repositório. Este repo só precisa avançar quando o host Windows mudar ou quando um novo candidato Desktop realmente for produzido/validado. [Regra canônica de composição](https://github.com/ordaxsystems/ordax-os/blob/main/docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13).

## Build e testes

- Desenvolvimento: [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md).
- Build, origem e segurança: [BUILD-AND-PROVENANCE.md](BUILD-AND-PROVENANCE.md).
- Testes portáveis: `npm test` (sem compilar kernel, Buildroot ou instalador).

O canal Desktop **Dev mantém uma única revisão Native instalada depois da
confirmação de saúde**. Durante o teste de uma atualização, conserva apenas o
Native ativo e o candidato até a decisão; uma falha restaura o ativo sem tocar
na versão atual. Depois de um boot saudável, a limpeza canônica retira revisões
superadas, sem tocar no toolchain compartilhado, credenciais ou dados do usuário.

A CI `Desktop Source Contracts` valida a fonte e chama o produtor Windows canônico usando a **revisão OrdaX/OS configurada no workflow/candidato atual**. Não copie para este README um SHA como instrução operacional: a identidade vigente deve ser lida do workflow, do candidato e da proveniência instalada. A revisão da Surface é transitiva à composição do OS e não recebe um segundo pin neste repositório. A proveniência instalada registra as identidades diretas necessárias para reconstruir o candidato.

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
assinatura Stable nem os gates atuais de Creator/distribuição. Esses estados
devem ser lidos da proveniência, do candidato e dos contratos vigentes, não
inferidos da [PR histórica OS #2403](https://github.com/ordaxsystems/ordax-os/pull/2403).

## Windows window layout (Electron owner)

The Desktop persists normal bounds and maximized state in the existing user
profile and restores them within the available display work areas. Hot-unplug,
RDP and display-metric changes recover windows that would otherwise be offscreen.
This functionality lives in `window-layout.cjs`, not in OS Native or Surface.
Run `node --test window-layout.test.cjs` for its focused regression tests.

Revisões de empacotamento anteriores, versões alpha e SHAs de OS são
**evidência histórica, não instrução operacional**. O candidato Desktop atual
deve obter a revisão Native diretamente do workflow/configuração/proveniência
vigentes. O shell permanece em `ordax-desktop`; CI isolada não prova instalação
física, assinatura ou trust.
