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

## Atualização Dev da shell sem instalador NSIS

O host Electron pode receber somente o delta de arquivos `*.cjs`/`*.mjs`
do commit exato da `ordax-desktop/main`, **sem baixar o NSIS de ~679 MB**:

```powershell
node ci/dev-shell-delta.cjs --verify
# Feche normalmente o OrdaX OS Desktop Dev antes de instalar:
node ci/dev-shell-delta.cjs --install
```

O utilitário usa apenas Node.js e o Git existente, exige checkout limpo na
`main` oficial, compara blobs Git, SHA-256 e integridade ASAR, e aborta com
o Desktop aberto ou uma transação de atualização Native pendente. Troca apenas
`resources/app.asar` da instalação Dev única e exige `Native Surface ready`
após reiniciar; preserva o arquivo anterior para reversão em caso de falha.
Não atualiza binário Electron, bibliotecas nativas, Surface/OS, modelos ou Stable;
para alteração desses componentes, permanece necessário o produtor oficial.

Teste direcionado: `node --test ci/dev-shell-delta.test.cjs`.

### Prova de troca e recuperação em uma cópia isolada

O teste de transação usa a mesma função de instalação do modo Dev, mas
substitui apenas o sinalizador de saúde por um resultado controlado e mantém
os arquivos em um diretório temporário. Não abre outra instância do Desktop:

```powershell
$env:ORDAX_DESKTOP_ISOLATED_ASAR = Join-Path $env:LOCALAPPDATA 'Programs\OrdaX OS Desktop Dev\resources\app.asar'
node --test --test-name-pattern='physical Windows ASAR' ci/dev-shell-delta.test.cjs
Remove-Item Env:\ORDAX_DESKTOP_ISOLATED_ASAR
```

Essa prova cobre substituição, hash, recibo, falha e rollback com os **bytes
reais do ASAR**, sem modificar a instalação operacional. Quando o processo
iniciado pelo utilitário não alcança `Native Surface ready`, somente a árvore
desse PID é encerrada antes de restaurar o `app.asar` anterior. Se o processo
não puder ser encerrado ou outro Desktop estiver em execução, a restauração
falha fechada e preserva o rollback para recuperação segura.
**Não** substitui o smoke com inicialização real de uma nova revisão ou
a homologação do NSIS Stable.

### Recuperação após uma interrupção do Windows

O modo `--install` verifica arquivos `.delta-rollback`, `.delta-ready` e recibos
incompletos antes de preparar a próxima atualização. Com o Desktop fechado e
sem transação Native pendente, restaura o último ASAR válido quando não existe
recibo de saúde confirmado, ou conclui a limpeza quando o recibo válido atesta
a nova shell. A recuperação valida a identidade canônica e a integridade do
ASAR, inclusive após futuras mudanças de versão do pacote Dev, sem aceitar
nomes de produto distintos. Um arquivo divergente ou suspeito bloqueia a
operação e preserva a evidência. `--verify` permanece somente leitura.
