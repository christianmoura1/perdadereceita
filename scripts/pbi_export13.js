// pbi_export13.js — exporta a aba "13. Tabela de Extracao" em Excel.
//
// COMO O DOWNLOAD FUNCIONA AQUI (duas tentativas erradas antes desta, fica o registro):
//   1. `download.saveAs()` -> morria com "canceled" na execucao agendada.
//   2. `download.path()`   -> devolvia vazio ("download nao chegou ao disco").
//   3. vigiar C:\Users\<user>\Downloads -> o arquivo nunca aparece la.
// Motivo: o Playwright esta conectado a um Chrome que NAO foi ele quem abriu
// (CDP 9222), entao ele nao gerencia o ciclo de vida do download.
//
// O jeito que funciona e' falar com o Chrome direto, por CDP:
// `Browser.setDownloadBehavior` com um downloadPath nosso. O Chrome passa a
// gravar exatamente onde mandamos, e aqui so' esperamos o arquivo estabilizar.
//
// Requer: aba do relatorio (44db1b) aberta e LOGADA no Chrome com CDP 9222,
// com BKB e MANUTENCAO selecionados.
// Uso: node scripts\pbi_export13.js  -> imprime o caminho do .xlsx na ultima linha

const { chromium } = require('C:/projetos/certponto-report/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const ROOT = path.join('C:', 'projetos', 'perdadereceita');
const DIR = path.join(ROOT, 'downloads');
const CAIXA = path.join(DIR, 'chrome');   // onde o Chrome vai soltar o arquivo
const ESPERA_MS = 180000;
const TENTATIVAS = 2;

const ts = () => new Date().toISOString();
const info = (msg, extra) => console.log(JSON.stringify({ ts: ts(), level: 'info', msg, ...extra }));
const erro = (msg, extra) => console.error(JSON.stringify({ ts: ts(), level: 'error', msg, ...extra }));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const info2 = info;

// Espera um .xlsx novo E estavel (o Chrome escreve .crdownload enquanto baixa).
async function esperarArquivo(dir, antes, limiteMs) {
  const inicio = Date.now();
  let alvo = null;
  let tamAnterior = -1;
  let estavel = 0;

  while (Date.now() - inicio < limiteMs) {
    let atuais = [];
    try { atuais = fs.readdirSync(dir); } catch { /* pasta ainda nao criada */ }

    if (!alvo) {
      const novos = atuais.filter((n) => !antes.has(n) && /\.xlsx$/i.test(n));
      if (novos.length) {
        alvo = novos
          .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
          .sort((a, b) => b.t - a.t)[0].n;
        info('arquivo aparecendo', { arquivo: alvo });
      }
    }

    if (alvo) {
      const p = path.join(dir, alvo);
      let tam = 0;
      try { tam = fs.statSync(p).size; } catch { tam = 0; }
      if (tam > 0 && tam === tamAnterior) {
        estavel += 1;
        if (estavel >= 2) return p;
      } else {
        estavel = 0;
      }
      tamAnterior = tam;
    }
    await dormir(1000);
  }
  return null;
}

// O filtro de data do relatorio NAO avanca sozinho: fica parado no dia em que
// alguem o deixou, e o export sai sempre atrasado (em 21/08 estava em 8/19 com
// dados ate 8/20). Aqui a data final e' empurrada para o maximo que o proprio
// BI declara no aria-label do campo -- nada de data chutada.
async function avancarDataFinal(page) {
  const info = await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')]
      .find((x) => /End date/i.test(x.getAttribute('aria-label') || ''));
    if (!i) return null;
    const m = (i.getAttribute('aria-label') || '').match(/to (\d{1,2}\/\d{1,2}\/\d{4})/);
    return { atual: i.value, maximo: m ? m[1] : null };
  });
  if (!info || !info.maximo) { info2('filtro de data nao localizado; seguindo assim mesmo'); return; }
  if (info.atual === info.maximo) { info2('filtro de data ja no maximo', { data: info.maximo }); return; }

  const campo = page.locator('input[aria-label*="End date"]').first();
  await campo.click({ clickCount: 3 }).catch(() => {});
  await dormir(400);
  await campo.fill(info.maximo).catch(async () => {
    await campo.press('Control+a').catch(() => {});
    await campo.type(info.maximo, { delay: 60 });
  });
  await campo.press('Enter').catch(() => {});
  await dormir(9000);
  info2('filtro de data avancado', { de: info.atual, para: info.maximo });
}

async function umaTentativa(page, cliente, tentativa) {
  await page.keyboard.press('Escape').catch(() => {});
  await dormir(1000);

  const a13 = page.locator('text=/13\\. Tabela de Extra/i').first();
  if (!(await a13.count())) throw new Error('pagina "13. Tabela de Extracao" nao encontrada no menu');
  await a13.click({ force: true }).catch(() => {});
  await dormir(8000);
  info('na aba 13', { tentativa });

  await avancarDataFinal(page);

  await page.locator('.mid-viewport').first().hover().catch(() => {});
  await dormir(1500);
  await page.locator('button[aria-label*="More options"]').last().click({ force: true }).catch(() => {});
  await dormir(2500);

  const exportar = page.getByText('Export data', { exact: true }).first();
  if (!(await exportar.count())) throw new Error('opcao "Export data" nao apareceu no menu do visual');
  await exportar.click({ force: true }).catch(() => {});
  await dormir(4500);
  info('dialogo de exportacao aberto', { tentativa });

  // manda o Chrome gravar na nossa caixa, nao onde ele quiser
  fs.mkdirSync(CAIXA, { recursive: true });
  await cliente.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: CAIXA,
    eventsEnabled: true,
  });

  const antes = new Set(fs.readdirSync(CAIXA));

  const botao = page.locator('button').filter({ hasText: /^Export$/ }).last();
  if (!(await botao.count())) throw new Error('botao Export nao encontrado no dialogo');
  await botao.click({ force: true });
  info('export disparado', { tentativa, caixa: CAIXA });

  const baixado = await esperarArquivo(CAIXA, antes, ESPERA_MS);
  if (!baixado) throw new Error(`nenhum .xlsx apareceu em ${ESPERA_MS / 1000}s`);

  const destino = path.join(DIR, 'aba13-' + new Date().toISOString().slice(0, 10) + '.xlsx');
  fs.copyFileSync(baixado, destino);
  try { fs.unlinkSync(baixado); } catch { /* nao atrapalha */ }

  const bytes = fs.statSync(destino).size;
  if (bytes < 10000) throw new Error(`export saiu pequeno demais (${bytes} bytes) — provavelmente vazio`);
  return { destino, bytes };
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);

  let page = null;
  for (const c of browser.contexts()) for (const p of c.pages()) {
    if (p.url().includes('44db1b')) page = p;
  }
  if (!page) throw new Error('aba do Perda de Receita (44db1b) nao esta aberta no Chrome');
  if (/login\.microsoftonline|oauth2/.test(page.url())) {
    throw new Error('a aba esta na tela de login — relogar no Power BI pelo RDP');
  }
  info('aba encontrada');

  const cliente = await page.context().newCDPSession(page);

  let ultimoErro = null;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      const r = await umaTentativa(page, cliente, t);
      info('export concluido', { arquivo: r.destino, bytes: r.bytes, tentativa: t });
      await page.keyboard.press('Escape').catch(() => {});
      await browser.close();
      console.log(r.destino);
      return;
    } catch (e) {
      ultimoErro = e;
      erro('tentativa falhou', { tentativa: t, erro: e.message });
      if (t < TENTATIVAS) { await page.keyboard.press('Escape').catch(() => {}); await dormir(5000); }
    }
  }
  throw ultimoErro ?? new Error('export falhou sem motivo identificado');
})().catch((e) => { erro('export falhou', { erro: e.message }); process.exit(1); });
