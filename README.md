# OrdaX Desktop — Windows

Repositório proprietário do host **Electron**, janelas, instalador Windows,
integração com Native e atualização de desenvolvimento. Não possui kernel,
serviços do OS, interface Surface, modelos de IA, grants ou Runtime MCP.

A fonte inicial foi importada **sem alterações de bytes** de
`ordaxsystems/ordax-os` na revisão `526b0e46`. O recibo em
[docs/source-import.json](docs/source-import.json) identifica o commit, a
subárvore original e o commit inicial `a849bbc5` deste repositório.

**Status:** importado e com CI própria de contratos; o corte de instalação
ainda não ocorreu. Até a homologação cross-repo/upgrade físico, a PR
[ordax-os #2403](https://github.com/ordaxsystems/ordax-os/pull/2403)
mantém o empacotamento Dev existente. Não publicar nem mudar o appId/canal.

## Testes sem dependências externas

```bash
node --test owner-export.test.cjs standalone-stage.test.cjs local-dev.test.cjs
```

A CI Windows confirma que a fonte importada é idêntica à árvore Git original,
valida o contrato existente do OS e o lock da Surface, e testa a Shell em
checkouts descartáveis. Não recompila o runtime nem cria outro instalador.

Desenvolvimento visual: instale o Electron com `npm ci` e defina
`ORDAX_DESKTOP_OS_CHECKOUT` e `ORDAX_SURFACE_CHECKOUT` para
checkouts reais; veja [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md).

A CI Windows usa um **único** produtor NSIS: o workflow reutilizável
`windows-desktop-dev.yml` do `ordax-os`, pinado em
`848584c9a14f85b5c591d682d91f9e5c32a1e0d9`. O repositório privado
Desktop fornece o commit da shell com token somente leitura; o OS continua
produzindo Native e Surface. O manifesto instalado deve vincular os dois SHAs
e identificar Desktop como proprietário da shell e OS como proprietário do
runtime. Não há segundo compilador ou artefato de release em paralelo.

A validação de upgrade/rollback a partir de uma **versão anterior já instalada**
ainda é um gate obrigatório antes de remover a shell antiga do OS. Nenhum
código Native/Surface será copiado aqui.
