require('dotenv').config();

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'christianmoura1';
const GITHUB_REPO = process.env.GITHUB_REPO || 'perdadereceita';
const TARGET_NUMBER = (process.env.WHATSAPP_TARGET_NUMBER || '').replace(/\D/g, '');
const SUMMARY_CRON = process.env.SUMMARY_CRON || '0 8 * * *';
const CI_CHECK_CRON = process.env.CI_CHECK_CRON || '*/10 * * * *';

if (!GITHUB_TOKEN) {
  throw new Error('Defina GITHUB_TOKEN no arquivo .env');
}
if (!TARGET_NUMBER) {
  throw new Error('Defina WHATSAPP_TARGET_NUMBER no arquivo .env');
}

const STATE_PATH = path.join(__dirname, 'state.json');
const AUTH_PATH = path.join(__dirname, 'auth');
const TARGET_JID = `${TARGET_NUMBER}@s.whatsapp.net`;

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  }
  return { alertedRunIds: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function githubGet(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'whatsapp-secretary',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${pathname} -> ${res.status}`);
  }
  return res.json();
}

let sock;

async function sendWhatsApp(text) {
  if (!sock) return;
  await sock.sendMessage(TARGET_JID, { text });
}

async function buildDailySummary() {
  const repoInfo = await githubGet(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}`);
  const defaultBranch = repoInfo.default_branch;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const commits = await githubGet(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?sha=${defaultBranch}&since=${since}`
  );

  const prsResponse = await githubGet(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?state=open&per_page=20`
  );

  const runsResponse = await githubGet(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?branch=${defaultBranch}&per_page=1`
  );
  const lastRun = runsResponse.workflow_runs && runsResponse.workflow_runs[0];

  const lines = [`Resumo diario - ${GITHUB_REPO}`, ''];

  if (commits.length === 0) {
    lines.push('Sem commits novos nas ultimas 24h.');
  } else {
    lines.push(`${commits.length} commit(s) nas ultimas 24h:`);
    for (const c of commits.slice(0, 10)) {
      const msg = c.commit.message.split('\n')[0];
      lines.push(`- ${msg} (${c.commit.author.name})`);
    }
  }

  lines.push('');
  if (prsResponse.length === 0) {
    lines.push('Nenhum PR aberto no momento.');
  } else {
    lines.push(`${prsResponse.length} PR(s) aberto(s):`);
    for (const pr of prsResponse.slice(0, 10)) {
      lines.push(`- #${pr.number} ${pr.title} (${pr.user.login})`);
    }
  }

  lines.push('');
  if (lastRun) {
    const status = lastRun.conclusion || lastRun.status;
    lines.push(`Ultimo CI (${defaultBranch}): ${status}`);
  }

  return lines.join('\n');
}

async function checkCiFailures(state) {
  const runsResponse = await githubGet(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs?per_page=5`
  );
  if (!runsResponse.workflow_runs) return;

  for (const run of runsResponse.workflow_runs) {
    if (run.conclusion === 'failure' && !state.alertedRunIds.includes(run.id)) {
      await sendWhatsApp(
        `Alerta: CI falhou em ${GITHUB_REPO}\n` +
          `Workflow: ${run.name}\n` +
          `Branch: ${run.head_branch}\n` +
          `${run.html_url}`
      );
      state.alertedRunIds.push(run.id);
      if (state.alertedRunIds.length > 200) {
        state.alertedRunIds = state.alertedRunIds.slice(-200);
      }
      saveState(state);
    }
  }
}

async function start() {
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_PATH);

  sock = makeWASocket({ auth: authState });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Escaneie o QR code abaixo com o WhatsApp (Aparelhos conectados > Conectar aparelho):');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(
        'Conexao fechada.',
        shouldReconnect ? 'Reconectando em 5s...' : 'Sessao deslogada — apague a pasta auth/ e rode de novo para gerar novo QR.'
      );
      if (shouldReconnect) {
        setTimeout(start, 5000);
      }
    } else if (connection === 'open') {
      console.log('Conectado ao WhatsApp com sucesso.');
    }
  });

  const state = loadState();

  cron.schedule(SUMMARY_CRON, async () => {
    try {
      const summary = await buildDailySummary();
      await sendWhatsApp(summary);
      console.log('Resumo diario enviado.');
    } catch (err) {
      console.error('Erro ao gerar/enviar resumo diario:', err.message);
    }
  });

  cron.schedule(CI_CHECK_CRON, async () => {
    try {
      await checkCiFailures(state);
    } catch (err) {
      console.error('Erro ao checar falhas de CI:', err.message);
    }
  });

  console.log(`Resumo diario agendado: ${SUMMARY_CRON}`);
  console.log(`Checagem de CI agendada: ${CI_CHECK_CRON}`);
}

start();
