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

A CI de build/release independente e a validação de atualização de uma
versão instalada anterior ainda são gates obrigatórios antes de retirar
o código original do OS. Nenhum código Native/Surface será copiado aqui.
