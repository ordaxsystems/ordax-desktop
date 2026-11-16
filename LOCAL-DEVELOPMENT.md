# OrdaX Desktop — desenvolvimento local com OS e Surface separados

Fonte do host: `ordaxsystems/ordax-desktop`. Dependências Native e contratos:
`ordaxsystems/ordax-os`. Visual única: `ordaxsystems/ordax-surface`.
Não copie `system/`, modelos, nem a Surface para o Desktop.

Após clonar os três repositórios, confira que os remotos Git sejam oficiais e
que o checkout da Surface pertença ao origin oficial e contenha
como ancestral o commit do `docs/contracts/surface-source.json` do OS.
Apenas o HMR local aceita commits posteriores por fast-forward; o
instalador e as provas de proveniência continuam exigindo o SHA exato.

```powershell
cd ordax-os
npm ci
cd ../ordax-desktop
npm ci
$env:ORDAX_DESKTOP_OS_CHECKOUT = (Resolve-Path '../ordax-os').Path
$env:ORDAX_SURFACE_CHECKOUT = (Resolve-Path '../ordax-surface').Path
npm run dev:local
```

O script `local-dev.cjs` valida cada checkout, seu origin e a ancestralidade
do lock antes de montar a Surface via junctions ignoradas pelo Git. O
desenvolvimento visual pode avançar no repositório Surface oficial sem
alterar o lock. Para publicar um novo materializado, o owner do OS
atualiza seu próprio lock e a CI atesta o SHA exato. Nenhuma fonte visual
é copiada para o Desktop. A ausência de ferramentas, vínculos ou permissões
falha fechada, sem instalar um segundo runtime.

O workflow do instalador usa os dois SHAs exatos e executa os testes Native
e NSIS em runner descartável Windows. Desenvolvimento local, HMR e testes
não substituem autorização de assinatura Stable nem comprovam upgrade NSIS.

## Verificação da shell Dev e recuperação de transações antigas

No Windows, o executável Electron 40 inclui um recurso de integridade com o
SHA-256 do cabeçalho `resources/app.asar`. Alterar apenas CJS/MJS dentro
desse arquivo muda seu hash e o executável rejeita a inicialização, mesmo
quando os arquivos Git e os blocos ASAR possuem hashes individuais válidos.
Por isso o antigo `--install` de delta isolado está **bloqueado**: para
atualizar o próprio host Electron, usar o produtor NSIS canônico, com provas
de integridade, instalação e rollback; não alterar o executável nem suas
proteções para contornar o bloqueio.

O diagnóstico permanece sem modificação da instalação e verifica a `main`
oficial limpa, o commit remoto, os blobs Git, a identidade do pacote e os
arquivos da shell instalados:

```powershell
node ci/dev-shell-delta.cjs --verify
# DESKTOP_SHELL_DELTA=CURRENT ou INSTALLER_REQUIRED
```

A atualização automática da **composição OS/Surface** continua no
`ordax-pull` Native já existente e não exige reconstruir o NSIS quando
a shell Electron não mudou. Testes somente de fonte seguem sem rebuild
do instalador.

Para recuperar um arquivo `.delta-rollback` deixado por uma execução
anterior interrompida, e **somente com o Desktop fechado**, executar:

```powershell
node ci/dev-shell-delta.cjs --recover
```

A recuperação exige checkout Desktop canônico, sincronizado e limpo;
valida o ASAR, o recibo anterior e a ausência de atualização Native
pendente antes de tocar arquivos. Nunca inicia uma nova tentativa de delta.
Se houver indícios divergentes ou processos ainda vivos, falha fechado.
Teste direcionado: `node --test ci/dev-shell-delta.test.cjs`.

### NSIS substitui a shell Dev

O hook oficial de instalação NSIS reconcilia recibos da antiga shell ao
instalar uma composição verificada. Quando existirem transações incompletas,
use primeiro a recuperação segura acima; não apague backups manualmente.
Preservar estado Native, identidade, permissões e rollback.

### Recuperação do host Native após uma falha

O Electron monitora a saída inesperada **do processo Native já homologado**.
Se o pacote instalado não tiver identidade Product Runtime inscrita, faz no
máximo **uma reinicialização completa do Electron**, preservando o caminho
canônico de boot, os tokens efêmeros e o verificador de saúde existente.
Se o host falhar novamente, mostra erro real em vez de entrar num loop.

Com uma identidade Product Runtime presente, a reinicialização automática
é bloqueada: após uma falha do processo-pai, o agente Windows filho pode
continuar ativo. O Desktop não inicia outro agente sem a autoridade do
Supervisor Native para comprovar a terminação do anterior. Desligamento
normal, candidato descartado e processos antigos não acionam recuperação.
Isto não declara prontidão MCP nem equivale a reconexão remota atestada.
A instalação operacional não deve ser reiniciada como parte dos testes de
código: host-recovery.test.cjs cobre o observador e seus limites.
### Proteção do frame principal da Surface

Os grants Native da shell independente são associados ao frame principal
verificado da Surface, à origem exata do loopback e ao documento atual.
Um iframe da mesma página, inclusive hospedado na mesma origem, ou uma
janela externa não herda File, Session, State, Aura ou Surface Report.
Requisições durante transição de navegação ou sem frame válido falham
fechadas. Os testes direcionados ficam em native-grant-frame.test.cjs.

### Grant da Surface para o Product Native

Na shell independente, cada inicialização gera um `surfaceReportToken` próprio,
distinto dos demais grants. O Electron só adiciona
`X-OrdaX-Surface-Report-Token` às três rotas canônicas
`desktop-surface-state`, `desktop-surface-command` e `desktop-surface-receipt`
quando a requisição parte do WebContents da Surface verificada; remove
qualquer cabeçalho homônimo fornecido pelo renderer. O host repassa esse token
apenas ao Native filho, que valida a identidade e permanece fail-closed.
Esse grant local **não** inscreve o Device Product e não transfere os grants do
MCP auxiliar. A prontidão de dispatch pertence ao Runtime canônico: o Supervisor
só pode projetar `productDispatchReady` depois de validar o handoff launch-bound,
o `/readiness` do mesmo processo e seu `capabilities_digest`. Essa prontidão não
autoriza o ChatGPT e não cria/renova binding; binding e grants continuam na
Platform. Os campos legados `mcpReady` e `centralSessionAttested` não devem ser
reanimados como prova de sessão. Uma revisão Native rejeitada conserva o rollback
até ser revalidada com a shell corrigida; não apagar evidências ou forçar sucesso.
