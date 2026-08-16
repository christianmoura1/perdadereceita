#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Auditoria NAO DESTRUTIVA da VPS.
#
# Este script SO LE. Ele nao instala, nao remove, nao reinicia servico, nao
# altera firewall, SSH, Git ou codigo. Pode ser rodado com seguranca em
# producao, a qualquer hora.
#
# Uso:
#     bash auditar-vps.sh > auditoria-vps.txt 2>&1
#
# Depois abra o auditoria-vps.txt (ou cole o conteudo no chat da IA) para
# montar o mapa do servidor.
#
# Segredos: o script lista ONDE existem arquivos .env e credenciais, mas
# nunca imprime o conteudo deles.
# ---------------------------------------------------------------------------
set -u

sec() { printf '\n\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }
# roda um comando so se ele existir; senao avisa e segue
try() { if have "$1"; then "$@" 2>&1; else echo "(nao instalado: $1)"; fi; }

echo "AUDITORIA VPS - $(date -Is)"

# --------------------------------------------------------------------------
sec "1. SISTEMA"
echo "hostname : $(hostname -f 2>/dev/null || hostname)"
echo "uptime   : $(uptime -p 2>/dev/null || uptime)"
echo "kernel   : $(uname -a)"
echo "--- distro ---"
cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|VERSION_ID)='
echo "--- virtualizacao ---"
try systemd-detect-virt

sec "2. RECURSOS (CPU / MEMORIA / DISCO)"
echo "--- cpu ---"
nproc 2>/dev/null
grep -m1 'model name' /proc/cpuinfo 2>/dev/null
echo "--- load ---"
cat /proc/loadavg
echo "--- memoria ---"
free -h
echo "--- disco ---"
df -h -x tmpfs -x devtmpfs 2>/dev/null
echo "--- 15 maiores diretorios em / (pode demorar) ---"
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -15

sec "3. USUARIOS E PERMISSOES"
echo "usuario atual: $(id)"
echo "--- usuarios com shell de login ---"
grep -E '/(bash|sh|zsh|fish)$' /etc/passwd | cut -d: -f1,3,6,7
echo "--- membros do grupo sudo/wheel ---"
getent group sudo wheel docker 2>/dev/null
echo "--- ultimos logins ---"
try last -n 15

# --------------------------------------------------------------------------
sec "4. PROJETOS - REPOSITORIOS GIT ENCONTRADOS"
# Procura .git ate 5 niveis nos lugares onde projeto costuma morar.
BUSCA="/root /home /opt /srv /var/www /apps /data"
for base in $BUSCA; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 -type d -name .git 2>/dev/null
done | sed 's#/\.git$##' | sort -u > /tmp/_repos.txt

if [ ! -s /tmp/_repos.txt ]; then
  echo "(nenhum repositorio git encontrado em: $BUSCA)"
else
  while read -r repo; do
    echo
    echo "########## $repo"
    echo "-- remote --"
    git -C "$repo" remote -v 2>&1 | head -4
    echo "-- branch atual --"
    git -C "$repo" rev-parse --abbrev-ref HEAD 2>&1
    echo "-- ultimo commit --"
    git -C "$repo" log -1 --pretty='%h  %ad  %an  %s' --date=iso 2>&1
    echo "-- alteracoes locais nao commitadas --"
    st=$(git -C "$repo" status --porcelain 2>&1)
    if [ -z "$st" ]; then echo "(limpo)"; else echo "$st" | head -20; fi
    echo "-- diferenca para o remoto --"
    git -C "$repo" status -sb 2>&1 | head -1
    echo "-- stash pendente --"
    git -C "$repo" stash list 2>&1 | head -5
  done < /tmp/_repos.txt
fi

sec "5. PROJETOS - PISTAS DE STACK (sem ler conteudo)"
while read -r repo; do
  [ -n "$repo" ] || continue
  echo "-- $repo"
  ls -1 "$repo" 2>/dev/null | grep -E -i \
    '^(package\.json|requirements\.txt|pyproject\.toml|Dockerfile|docker-compose|Makefile|go\.mod|Gemfile|composer\.json|ecosystem\.config|vercel\.json|next\.config|README)' \
    | sed 's/^/     /' || echo "     (sem marcador obvio)"
done < /tmp/_repos.txt 2>/dev/null

# --------------------------------------------------------------------------
sec "6. SERVICOS SYSTEMD (ativos)"
try systemctl list-units --type=service --state=running --no-pager --no-legend
echo "--- habilitados no boot ---"
try systemctl list-unit-files --state=enabled --no-pager --no-legend
echo "--- unidades customizadas (fora do pacote) ---"
ls -1 /etc/systemd/system/*.service 2>/dev/null

sec "7. SERVICOS COM FALHA"
try systemctl --failed --no-pager

sec "8. DOCKER"
if have docker; then
  echo "--- containers rodando ---"
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>&1
  echo "--- todos os containers ---"
  docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1
  echo "--- imagens ---"
  docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' 2>&1 | head -20
  echo "--- volumes ---"
  docker volume ls 2>&1 | head -20
  echo "--- compose encontrados ---"
  for base in $BUSCA; do
    [ -d "$base" ] || continue
    find "$base" -maxdepth 5 -name 'docker-compose*.y*ml' -o -maxdepth 5 -name 'compose.y*ml' 2>/dev/null
  done
else
  echo "(docker nao instalado)"
fi

sec "9. PM2 / PROCESSOS NODE"
try pm2 list
echo "--- pm2 startup configurado? ---"
ls -1 /etc/systemd/system/pm2-*.service 2>/dev/null || echo "(sem unit pm2)"
echo "--- processos node/python em execucao ---"
ps -eo pid,user,etime,pcpu,pmem,args --sort=-pmem 2>/dev/null \
  | grep -E 'node|python|gunicorn|uvicorn|java|ruby' | grep -v grep | head -20

sec "10. TOP 15 PROCESSOS POR MEMORIA"
ps -eo pid,user,pcpu,pmem,etime,comm --sort=-pmem 2>/dev/null | head -16

# --------------------------------------------------------------------------
sec "11. CRON E AGENDAMENTOS"
echo "--- crontab do usuario atual ---"
crontab -l 2>&1
echo "--- crontab de todos os usuarios ---"
for u in $(cut -d: -f1 /etc/passwd); do
  c=$(crontab -l -u "$u" 2>/dev/null)
  [ -n "$c" ] && { echo "[$u]"; echo "$c"; }
done
echo "--- /etc/cron.d, cron.daily, crontab ---"
ls -1 /etc/cron.d/ 2>/dev/null
ls -1 /etc/cron.daily/ 2>/dev/null
grep -vE '^\s*(#|$)' /etc/crontab 2>/dev/null
echo "--- systemd timers ---"
try systemctl list-timers --all --no-pager

# --------------------------------------------------------------------------
sec "12. REDE - PORTAS EM ESCUTA"
if have ss; then
  ss -tulpn 2>/dev/null
else
  try netstat -tulpn
fi
echo
echo "ATENCAO: linhas com 0.0.0.0 ou ::: estao expostas a internet."
echo "         linhas com 127.0.0.1 estao so no localhost (seguro)."

sec "13. FIREWALL"
try ufw status verbose
echo "--- nftables ---"
try nft list ruleset
echo "--- iptables (resumo) ---"
try iptables -S

sec "14. SSH (configuracao efetiva, sem chaves)"
if have sshd; then sshd -T 2>/dev/null | grep -E \
  '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|allowusers|allowgroups|x11forwarding)' ; fi
echo "--- porta configurada no arquivo ---"
grep -E '^\s*Port' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
echo "--- quantidade de chaves autorizadas (conteudo NAO exibido) ---"
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] && echo "$f : $(grep -c . "$f" 2>/dev/null) chave(s)"
done
echo "--- fail2ban ---"
try fail2ban-client status

sec "15. VPN / ACESSO PRIVADO JA EXISTENTE"
try tailscale status
try wg show

# --------------------------------------------------------------------------
sec "16. RUNTIMES INSTALADOS"
for c in node npm npx pnpm yarn bun deno python3 pip3 uv poetry go ruby java php psql mysql redis-cli sqlite3 nginx caddy git tmux screen jq rsync; do
  if have "$c"; then
    printf '%-10s %s\n' "$c" "$("$c" --version 2>&1 | head -1)"
  else
    printf '%-10s -\n' "$c"
  fi
done
echo "--- gerenciadores de versao ---"
[ -d "$HOME/.nvm" ] && echo "nvm presente" || true
have nvm && nvm ls 2>&1 | head -5

sec "17. FERRAMENTAS DE IA JA INSTALADAS"
for c in claude codex gemini aider ollama; do
  if have "$c"; then
    printf '%-8s SIM  %s  (%s)\n' "$c" "$("$c" --version 2>&1 | head -1)" "$(command -v "$c")"
  else
    printf '%-8s nao\n' "$c"
  fi
done
echo "--- configuracao do Claude Code (so estrutura, sem credenciais) ---"
ls -la "$HOME/.claude" 2>/dev/null | head -20
echo "arquivos CLAUDE.md no servidor:"
for base in $BUSCA; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 -name 'CLAUDE.md' 2>/dev/null
done
echo "--- config do Codex/OpenAI (so estrutura) ---"
ls -la "$HOME/.codex" 2>/dev/null | head
echo "--- sessoes tmux ativas ---"
try tmux ls

sec "18. BANCOS DE DADOS"
echo "--- servicos de banco ativos ---"
try systemctl list-units --type=service --state=running --no-pager --no-legend | grep -E 'postgres|mysql|maria|mongo|redis'
echo "--- arquivos sqlite encontrados ---"
for base in $BUSCA; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 \( -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' \) 2>/dev/null
done | head -20
echo "--- bancos postgres (so nomes) ---"
have psql && su - postgres -c 'psql -lqt' 2>/dev/null | cut -d\| -f1 | grep -v '^\s*$' || echo "(sem acesso local ao postgres)"

sec "19. WEB SERVER / PROXY REVERSO"
echo "--- nginx sites habilitados ---"
ls -1 /etc/nginx/sites-enabled/ 2>/dev/null
echo "--- server_name e proxy_pass configurados ---"
grep -rhE '^\s*(server_name|proxy_pass|listen)' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sed 's/^\s*//' | sort -u | head -40
echo "--- Caddyfile ---"
[ -f /etc/caddy/Caddyfile ] && grep -vE '^\s*(#|$)' /etc/caddy/Caddyfile | head -30
echo "--- certificados SSL (dominios) ---"
ls -1 /etc/letsencrypt/live/ 2>/dev/null

sec "20. LOGS - ONDE ESTAO"
echo "--- maiores logs em /var/log ---"
du -ah /var/log 2>/dev/null | sort -rh | head -15
echo "--- erros recentes no journal (ultimas 24h, so contagem por unidade) ---"
try journalctl --since '24 hours ago' -p err --no-pager -o short | awk '{print $5}' | sort | uniq -c | sort -rn | head -15
echo "--- diretorios de log dentro dos projetos ---"
while read -r repo; do
  [ -n "$repo" ] || continue
  find "$repo" -maxdepth 3 -type d -name 'logs' 2>/dev/null
done < /tmp/_repos.txt 2>/dev/null | head -20

sec "21. SEGREDOS - LOCALIZACAO (CONTEUDO NUNCA EXIBIDO)"
echo "Arquivos .env encontrados (apenas caminho, tamanho e permissao):"
for base in $BUSCA; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 5 -name '.env*' -type f 2>/dev/null
done | while read -r f; do
  printf '  %s  (%s bytes, %s)\n' "$f" "$(stat -c%s "$f" 2>/dev/null)" "$(stat -c%A "$f" 2>/dev/null)"
done
echo
echo "Atencao: .env com permissao diferente de -rw------- (600) esta legivel"
echo "por outros usuarios do servidor."
echo
echo "--- .env versionado por engano no git? ---"
while read -r repo; do
  [ -n "$repo" ] || continue
  tracked=$(git -C "$repo" ls-files 2>/dev/null | grep -E '(^|/)\.env' )
  [ -n "$tracked" ] && echo "  RISCO em $repo: $tracked"
done < /tmp/_repos.txt 2>/dev/null

sec "22. SCRIPTS ADMINISTRATIVOS / DE DEPLOY"
for base in $BUSCA; do
  [ -d "$base" ] || continue
  find "$base" -maxdepth 4 -type f \( -name '*.sh' -o -name 'deploy*' -o -name 'update*' -o -name 'atualiza*' \) 2>/dev/null
done | grep -vE 'node_modules|\.git/|venv|site-packages' | head -40

sec "23. ATUALIZACOES PENDENTES DO SISTEMA"
try apt list --upgradable
echo "--- reboot necessario? ---"
[ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo "nao"

rm -f /tmp/_repos.txt
echo
echo
echo "===== FIM DA AUDITORIA ====="
echo "Nada foi alterado no servidor."
