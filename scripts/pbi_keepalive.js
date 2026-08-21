// Keep-alive das abas do Power BI.
//
// POR QUE EXISTE: os dois analistas que leem o Power BI (Perda de Receita e
// Gestao de Risco) dependem de abas LOGADAS no Chrome da VPS. O Conditional
// Access da Zamp derruba a sessao de tempos em tempos e ninguem fica sabendo --
// o sintoma aparece de manha, quando o relatorio nao chega. O CertPonto ja
// tinha keepalive; o Power BI nao tinha, e foi essa a dor da semana de 18-21/08.
//
// O que faz: a cada execucao, "toca" nas duas abas (le o conteudo e da um
// scroll leve) para o Power BI nao considerar a sessao ociosa. Se encontrar uma
// aba na tela de login, avisa UMA vez no WhatsApp -- porque relogin exige humano
// (nao ha como automatizar sem contornar o Conditional Access, e isso nao se faz).
//
// Estado em data/pbi-keepalive.json evita repetir o aviso a cada 30 min.
// Uso: node scripts\pbi_keepalive.js

const { chromium } = require('C:/projetos/certponto-report/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const ESTADO = path.join('C:', 'projetos', 'mordomo', 'data', 'pbi-keepalive.json');

const ABAS = [
  { id: '44db1b', nome: 'Perda de Receita', marcador: /Perda de receita/i },
  { id: 'e07d5c', nome: 'Gestao de Risco', marcador: /GEST.O DE RISCO|Rota de Seguran/i },
];

const ts = () => new Date().toISOString();
const info = (msg, extra) => console.log(JSON.stringify({ ts: ts(), level: 'info', msg, ...extra }));
const erro = (msg, extra) => console.error(JSON.stringify({ ts: ts(), level: 'error', msg, ...extra }));

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return {}; }
}
function salvarEstado(e) {
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true });
  fs.writeFileSync(ESTADO, JSON.stringify(e, null, 2));
}

async function avisar(texto) {
  const url = (process.env.UAZAPI_URL || '').replace(/\/+$/, '');
  const token = process.env.UAZAPI_TOKEN;
  const dest = process.env.MORDOMO_OWNER_NUMBER;
  if (!url || !token || !dest) { erro('sem credenciais para avisar'); return; }
  await fetch(`${url}/send/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify({ number: dest, text: texto }),
  }).catch((e) => erro('falha ao avisar', { erro: e.message }));
}

(async () => {
  const estado = lerEstado();
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP);
  } catch (e) {
    erro('Chrome com CDP nao respondeu', { erro: e.message });
    process.exit(1);
  }

  const paginas = [];
  for (const c of browser.contexts()) for (const p of c.pages()) paginas.push(p);

  const caidas = [];
  const vivas = [];

  for (const aba of ABAS) {
    const pg = paginas.find((p) => p.url().includes(aba.id));
    if (!pg) {
      caidas.push({ ...aba, motivo: 'aba nao esta aberta' });
      continue;
    }
    if (/login\.microsoftonline|oauth2/.test(pg.url())) {
      caidas.push({ ...aba, motivo: 'caiu na tela de login da Microsoft' });
      continue;
    }
    try {
      const txt = await pg.evaluate(() => (document.body ? document.body.innerText : ''));
      if (!aba.marcador.test(txt)) {
        caidas.push({ ...aba, motivo: 'a aba nao mostra mais o relatorio' });
        continue;
      }
      // toque leve: rola um pouco e volta, para nao ficar ociosa
      await pg.evaluate(() => {
        const t = document.querySelector('.mid-viewport');
        if (t) { t.scrollTop += 40; setTimeout(() => { t.scrollTop -= 40; }, 300); }
        window.dispatchEvent(new Event('focus'));
      }).catch(() => {});
      vivas.push(aba.nome);
    } catch (e) {
      caidas.push({ ...aba, motivo: `erro ao ler: ${e.message.slice(0, 80)}` });
    }
  }

  await browser.close().catch(() => {});

  // avisa uma vez por aba caida; limpa quando ela volta
  const novas = [];
  for (const c of caidas) {
    if (!estado[c.id]) {
      estado[c.id] = { desde: ts(), motivo: c.motivo };
      novas.push(c);
    }
  }
  for (const nome of vivas) {
    const aba = ABAS.find((a) => a.nome === nome);
    if (aba && estado[aba.id]) { delete estado[aba.id]; info('aba voltou', { aba: nome }); }
  }
  salvarEstado(estado);

  if (novas.length) {
    const linhas = novas.map((c) => `• *${c.nome}* — ${c.motivo}`);
    await avisar([
      '*Supervisor*',
      '',
      'A sessao do Power BI precisa de login manual:',
      '',
      linhas.join('\n'),
      '',
      'Entre por RDP (154.64.32.227:3389), reloge na aba e me avise.',
      'Sem isso o relatorio da manha nao sai.',
      '',
      'Nao vou repetir este aviso.',
    ].join('\n'));
    erro('abas caidas', { quantas: novas.length });
  }

  info('keepalive concluido', { vivas: vivas.length, caidas: caidas.length });
  process.exit(caidas.length ? 1 : 0);
})().catch((e) => { erro('keepalive falhou', { erro: e.message }); process.exit(1); });
