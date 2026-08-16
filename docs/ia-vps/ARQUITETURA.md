# IA administradora da VPS pelo celular

Documento de decisão. Escrito em 16/08/2026, depois da primeira rodada de auditoria.

## O problema que a auditoria revelou

A sessão em que este documento foi escrito rodou em `claude.ai/code`, num container efêmero da Anthropic. Ubuntu 24.04, 4 vCPU, 15 GB de RAM, criado no minuto em que a conversa começou e destruído quando ela termina. Sem systemd, sem Docker, sem cron, sem PM2. O único código presente era o clone do `perdadereceita`.

Ou seja: o Claude Code na web não enxerga a VPS. Ele clona repositório do GitHub e trabalha ali dentro. Serve muito bem pra alterar código e abrir PR pelo celular, e é provavelmente por isso que a impressão de "já tenho quase o que quero" apareceu. Mas ele não roda `systemctl status`, não lê `/var/log`, não reinicia serviço, não vê o que está de fato no servidor.

Pra administrar a VPS, o agente precisa estar **dentro** da VPS. Isso muda a arquitetura.

## Arquitetura recomendada

```
Celular (Termius)
   └─ SSH sobre Tailscale        ← rede privada, nada exposto na internet
        └─ VPS
             └─ tmux (sessão "ia")   ← sobrevive à queda da conexão
                  └─ claude          ← Claude Code CLI, acesso real ao servidor
                       └─ arquivos, git, systemd, docker, logs, bancos
```

Quatro peças. Nenhuma delas cobra nada a mais do que já se paga hoje.

### Por que Claude Code como cérebro, e não Codex

Os dois resolvem. A diferença que pesa aqui é o sistema de permissão. O Claude Code tem modos de permissão, allowlist por comando e hooks, o que dá pra usar exatamente no ponto 15 do pedido original: `rm -rf`, `DROP TABLE`, `force push` e alteração de firewall passam por confirmação, enquanto `git status` e `docker ps` rodam direto sem perguntar. O Codex CLI é bom em código, mas não tem esse controle fino sobre execução de comando no servidor.

Recomendação prática: Claude Code como agente principal na VPS, e o Codex continua onde já está, no trabalho de código. Não vale assinar nada novo pra isso.

### Por que Tailscale e não abrir a porta do SSH

Tailscale cria uma rede privada entre o celular e a VPS. O SSH passa a escutar só nesse endereço, e a porta 22 some da internet. Instala em cinco minutos, plano gratuito cobre até 100 dispositivos, e no celular é um aplicativo com um botão de ligar.

A alternativa é manter o SSH exposto com chave e fail2ban. Funciona, mas continua recebendo varredura o dia inteiro. Se o servidor hoje aceita senha no SSH, isso é o item mais urgente da lista.

Regra que não pode ser quebrada: o Tailscale precisa estar funcionando e testado **antes** de fechar qualquer coisa no firewall ou no SSH. Nunca se mexe nos dois ao mesmo tempo.

### Por que tmux

É o item 12 do pedido, e a resposta é direta. O `claude` roda dentro de uma sessão tmux chamada `ia`. O celular desconecta, troca de Wi-Fi pra 5G, o aplicativo fecha, e o processo continua rodando na VPS. Na volta:

```
tmux attach -t ia
```

E a conversa está no ponto onde parou, com a tarefa longa ainda em execução.

### Celular

Termius, gratuito, tem iOS e Android, guarda a chave SSH, suporta teclas de atalho e reconecta sozinho. Blink Shell é melhor no iPhone, mas é pago. Pra ditar por voz, o teclado do próprio celular resolve: dita a frase, o texto entra no prompt do Claude. Não precisa de integração nenhuma.

### Alternativa que foi descartada

Interface web na VPS (ttyd, code-server) atrás do Tailscale. Digitar fica um pouco melhor no navegador do celular, mas é mais um serviço rodando, mais uma superfície de ataque e mais uma coisa pra manter. O ganho não paga. Se um dia a digitação incomodar de verdade, dá pra adicionar depois sem refazer nada do resto.

## Contexto entre projetos

O ponto 16 (trocar de projeto conversando) e o 23 (documentação) se resolvem juntos, com arquivos `CLAUDE.md` que o Claude Code lê automaticamente ao entrar num diretório.

```
/root/CLAUDE.md              regras gerais do servidor e mapa dos projetos
<projeto>/CLAUDE.md          o que é, como sobe, onde ficam os logs, como faz deploy
```

O arquivo do servidor lista onde cada projeto mora, qual serviço responde por ele e quais comandos são seguros. O de cada projeto descreve o fluxo de deploy que já existe. Assim "entra no CertPonto e vê a última atualização" funciona sem explicar caminho toda vez.

Nenhum desses arquivos leva senha, token ou string de conexão. Só caminho, nome de serviço e procedimento.

## Custo

| Item | Custo |
|---|---|
| Claude Code na VPS | já incluso na assinatura Claude |
| Tailscale | grátis (plano pessoal) |
| Termius | grátis |
| tmux | grátis |
| **Total adicional** | **R$ 0** |

O que aumenta é o consumo de tokens da assinatura, porque o agente vai ler log e código do servidor. Se um dia bater no limite do plano, aí sim vale conversar sobre upgrade. Antes disso, não.

## Situação de cada projeto

### Perda de Receita

É o único projeto que deu pra auditar de verdade, porque é o repositório que estava clonado.

Repositório `christianmoura1/perdadereceita`, público, 3,9 MB, branch `main` limpa. Último commit em 15/08/2026: "Atualizar dados: Ago/2026 até dia 14 com percentuais oficiais do BI". O histórico mostra commit quase diário desde o começo do mês.

O pipeline funciona assim:

1. Exporta o XLSX do Power BI (aba `Export`) e lê os percentuais oficiais na tela do BI
2. Monta o `pct.json` com os percentuais por regional mais o Brasil
3. Roda `python3 scripts/gerar_dados.py --excel arquivo.xlsx --pct pct.json`, que grava `data/dados.json` e `data/detalhe-mes.json`
4. Confere com `python verifica.py --dia N --pct X --total Y`, que valida contra os números lidos do BI
5. Commit e push, e o Vercel publica o `index.html`

Na virada de mês entra `--objetivos objetivos.json` ou `--manter-objetivos`, e existe o `scripts/abrir_mes.py` pra abrir o mês só com as metas.

Fora do pipeline principal tem `gerar_relatorio.py` e `gerar_imagens.py`, que produzem o HTML e os PNG do WhatsApp, e três scripts de análise ad hoc (`analise_loja.py`, `analise_horas.py`, `analise_noturno.py`).

Duas observações que importam pro projeto da IA:

O deploy é Vercel, não a VPS. O `vercel.json` está no repositório e o site publica direto do `main`. Então "publique a atualização" é `git push`, e não deploy no servidor.

E "atualize a Perda de Receita" não dá pra automatizar por inteiro. As duas entradas são manuais: o XLSX exportado do Power BI e os percentuais lidos na tela. Enquanto for assim, o máximo que a IA faz é receber o arquivo, rodar o pipeline, validar e commitar. Automatizar de ponta a ponta exigiria acesso à API do Power BI, que é outro assunto.

Falta um `README.md` na raiz. Vale escrever um `CLAUDE.md` com esse fluxo, pra IA não ter que redescobrir toda vez.

### Clima Pro

Repositório `christianmoura1/climapro`, público, último push em 15/08/2026 às 22:45. É o repositório mais ativo da conta. Estrutura, banco, serviço e método de deploy só dá pra saber rodando a auditoria na VPS.

### CertPonto / Ponto

**Não existe repositório com esse nome na conta `christianmoura1`.** Os 14 repositórios visíveis são:

`climapro`, `perdadereceita`, `dashboard-tecnicos-sul`, `indicadores`, `PMOC`, `kanban-app`, `gelax`, `fastapi-python-boilerplate` (privado), `navegador`, `chat`, `Imagem-URL`, `tiktok`, `n8n-christian`, `vaga.ai`.

Três explicações possíveis: o projeto está só na VPS, sem repositório; está em outra conta do GitHub; ou tem outro nome aí na lista. A auditoria na VPS responde isso, porque a seção 4 do script lista todo repositório Git do servidor com o remote de cada um.

### Os outros repositórios

Nove deles não foram mencionados no pedido e não receberam push desde junho. `n8n-christian` chama atenção, porque se tiver n8n rodando na VPS já existe automação instalada que vale entender antes de propor qualquer coisa nova.

## O que ainda falta auditar

Tudo que depende de estar na VPS. O script `auditar-vps.sh` neste mesmo diretório cobre os 23 itens do ponto 7 do pedido: sistema, recursos, usuários, repositórios Git com remote e estado de cada um, serviços systemd, Docker, PM2, cron, portas em escuta, firewall, SSH, Tailscale, runtimes, ferramentas de IA já instaladas, bancos, nginx, logs, localização dos `.env` e scripts de deploy.

Ele só lê. Não instala, não remove, não reinicia serviço, não toca em firewall nem em SSH. Pode rodar em produção no meio do expediente.

```
git clone https://github.com/christianmoura1/perdadereceita /tmp/pr
bash /tmp/pr/docs/ia-vps/auditar-vps.sh > ~/auditoria-vps.txt 2>&1
```

Antes de mandar o resultado, dá uma passada de olho. O script foi escrito pra não imprimir conteúdo de `.env` nem chave, mas linha de comando de processo às vezes carrega token, e a saída do `nginx` pode ter domínio interno.

## Plano de implementação

**Fase 0 — auditoria.** Rodar o script e ler o resultado. Aqui aparece se já tem Claude Code instalado, se tem Docker, o que o CertPonto é de fato e como cada projeto faz deploy. Nada é decidido antes disso.

**Fase 1 — acesso seguro pelo celular.** Tailscale na VPS e no celular. Testar SSH pelo IP do Tailscale com o acesso atual ainda aberto. Só depois de conectar pelo celular é que se fecha a porta 22 na internet. Se o SSH ainda aceitar senha, desligar isso e deixar só chave.

**Fase 2 — agente na VPS.** Instalar ou atualizar o Claude Code, autenticar, criar a sessão tmux `ia` e configurar a allowlist de comandos: leitura e diagnóstico liberados, e confirmação obrigatória em `rm -rf`, `DROP`, `force push`, `systemctl stop`, alteração de firewall e de SSH.

**Fase 3 — memória do ambiente.** Escrever o `/root/CLAUDE.md` com o mapa que sair da auditoria, e um `CLAUDE.md` em cada projeto com o fluxo de deploy que já existe. Esta é a fase que transforma o agente em algo que conhece a casa.

**Fase 4 — rotina.** Um atalho de "bom dia" que checa disco, memória, serviços caídos, erro recente nos logs e alteração não commitada em cada repositório, e responde em quatro linhas em vez de despejar tudo.

**Fase 5 — o que sobrar.** Interface web, alerta por WhatsApp, verificação automática de madrugada. Só depois que o básico estiver rodando por algumas semanas.

A fase 1 leva uns 30 minutos. A 2, mais ou menos o mesmo. A 3 é a que dá trabalho de verdade, e é a que faz diferença no resultado.

## Riscos já visíveis

Não dá pra avaliar segurança sem a auditoria, mas duas coisas dá pra dizer agora.

Todos os repositórios da conta são públicos, menos o `fastapi-python-boilerplate`. `perdadereceita` e `climapro` são públicos e carregam dado operacional da rede. O `perdadereceita` ignora `*.xlsx` e `pct.json` no `.gitignore`, o que é correto, mas o `data/detalhe-mes.json` versionado tem 1,8 MB de detalhe por loja, hora e chamado, e está aberto pra qualquer um. Vale decidir se é pra ser assim.

E o agente de IA na VPS vai rodar com poder real de execução. A allowlist da fase 2 não é detalhe de configuração, é o que separa "conserta o serviço" de "derruba a produção". Ela precisa estar pronta antes do primeiro comando de escrita.
