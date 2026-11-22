# OrdaX Desktop — repositório de origem histórica

**Sem desenvolvimento, build ou publicação canônica neste repositório.**

O Desktop Windows foi consolidado em **[`ordaxsystems/ordax-os/desktop/`](https://github.com/ordaxsystems/ordax-os/tree/main/desktop)**. Fonte Electron, contratos, atualizador DEV, testes e produtor NSIS pertencem a **`ordax-os/main`**, com composição Native/Surface no mesmo commit. O pipeline antigo de publicação desta origem foi removido.

- **Código vigente:** https://github.com/ordaxsystems/ordax-os/tree/main/desktop
- **Produção Windows:** https://github.com/ordaxsystems/ordax-os/blob/main/.github/workflows/windows-desktop-dev.yml
- **Condições de corte e provas:** https://github.com/ordaxsystems/ordax-os/blob/main/desktop/docs/CUTOVER-2026-11-21.md

O histórico e as releases anteriores são preservados **apenas como evidência e para compatibilidade de instalações já distribuídas**. Nenhum PR, commit, tag ou workflow neste repositório antigo deve ser tratado como nova entrega do Desktop. Não reinstalar uma versão antiga nem criar outro updater/host Windows a partir dele.

O arquivamento GitHub definitivo depende de provar a migração do último canal instalado e os consumidores das releases históricas. **Não há segunda SSOT.**
