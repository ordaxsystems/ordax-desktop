# OrdaX Desktop — desenvolvimento local com OS e Surface separados

Fonte do host: `ordaxsystems/ordax-desktop`. Dependências Native e contratos:
`ordaxsystems/ordax-os`. Visual única: `ordaxsystems/ordax-surface`.
Não copie `system/`, modelos, nem a Surface para o Desktop.

Após clonar os três repositórios, confira que os remotos Git sejam oficiais e
que o checkout da Surface corresponda ao
`docs/contracts/surface-source.json` do OS selecionado.

```powershell
cd ordax-os
npm ci
cd ../ordax-desktop
npm ci
$env:ORDAX_DESKTOP_OS_CHECKOUT = (Resolve-Path '../ordax-os').Path
$env:ORDAX_SURFACE_CHECKOUT = (Resolve-Path '../ordax-surface').Path
npm run dev:local
```

O script `local-dev.cjs` valida cada checkout, seu origin e os commits
antes de montar a Surface via junctions ignoradas pelo Git. Alterar a revisão
da Surface requer atualizar o lock por meio do owner do OS, não copiar
componentes visuais. A ausência de ferramentas, vínculos ou permissões
falha fechada, sem instalar um segundo runtime.

O workflow do instalador usa os dois SHAs exatos e executa os testes Native
e NSIS em runner descartável Windows. Desenvolvimento local, HMR e testes
não substituem autorização de assinatura Stable nem comprovam upgrade NSIS.
