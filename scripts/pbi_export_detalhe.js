// pbi_export_detalhe.js — Exporta a "13. Tabela de Extracao" do Power BI como xlsx.
//
// Fluxo (tudo no Chrome depuravel 127.0.0.1:9222, sessao ja logada):
//   1. Vai para a aba 13
//   2. Corrige o slicer de data fim para o maximo disponivel (ele fica travado)
//   3. Botao direito na tabela -> "Show as a table"
//   4. "More options" -> "Export data" -> "Data with current layout" -> Export
//   5. Captura o download e salva em downloads\detalhe-AAAAMMDD.xlsx
//
// Saida: imprime "ARQUIVO=<caminho>" no final. Exit 0 = sucesso.
// NAO altera dados.json nem envia nada.

const fs = require('fs');
const path = require('path');
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = 'C:\\projetos\\perdadereceita\\downloads';

function agora() { return new Date().toISOString(); }
function logInfo(msg, extra) { console.log(JSON.stringify({ ts: agora(), level: 'info', msg, ...extra })); }
function fatal(msg, extra) { console.error(JSON.stringify({ ts: agora(), level: 'error', msg, ...extra })); process.exit(1); }

function stampData() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const destino = path.join(OUT_DIR, `detalhe-${stampData()}.xlsx`);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) fatal('aba do Power BI nao encontrada no Chrome');
  const frame = page.frames()[0];

  // downloads: garante comportamento via CDP (salva em OUT_DIR)
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR, eventsEnabled: true });
    logInfo('download behavior configurado', { dir: OUT_DIR });
  } catch (e) {
    logInfo('setDownloadBehavior falhou (seguindo)', { erro: e.message.slice(0, 120) });
  }

  // 1. aba 13 (tolerante: pode ja estar nela)
  const aba = frame.locator('text=/13\\. Tabela de Extra/i').first();
  await aba.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  await aba.click({ timeout: 8000 }).catch(() => logInfo('click da aba 13 pulado (ja estava nela?)'));
  await page.waitForTimeout(15000);
  logInfo('aba 13 aberta');

  // 2. slicer End date -> maximo disponivel
  try {
    const fim = frame.locator('input[aria-label*="End date"]').first();
    const aria = await fim.getAttribute('aria-label');
    const m = (aria || '').match(/to (\d{1,2}\/\d{1,2}\/\d{4})/);
    const atual = await fim.inputValue().catch(() => null);
    if (m && atual !== m[1]) {
      await fim.click({ timeout: 8000, force: true });
      await page.waitForTimeout(800);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(m[1], { delay: 40 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(14000);
      logInfo('slicer fim ajustado', { de: atual, para: m[1] });
    } else {
      logInfo('slicer fim ja no maximo', { valor: atual });
    }
  } catch (e) {
    fatal('falha ao ajustar slicer de data', { erro: e.message.slice(0, 200) });
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(600, 150).catch(() => {}); // fecha popups residuais
  await page.waitForTimeout(1000);

  // 3. botao direito na tabela -> "Show as a table"
  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
  });
  if (!box) fatal('visual da tabela detalhada nao localizado');
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForTimeout(2000);
  // clica no item VISIVEL do menu de contexto via coordenadas (existem
  // duplicatas ocultas com o mesmo texto no DOM)
  const clicarMenuVisivel = async (texto) => {
    const alvo = await frame.evaluate((t) => {
      const els = Array.from(document.querySelectorAll('[role="menuitem"], button, li, span, div'))
        .filter((b) => b.offsetParent !== null && (b.innerText || '').trim() === t);
      const el = els[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, texto);
    if (!alvo) return false;
    await page.mouse.click(alvo.x, alvo.y);
    return true;
  };
  if (!(await clicarMenuVisivel('Show as a table'))) fatal('menu "Show as a table" nao apareceu');
  await page.waitForTimeout(12000);
  logInfo('visao show-as-table aberta');

  // 4. More options -> Export data -> Export (mantem "Data with current layout")
  await frame.locator('button[aria-label="More options"]').last().click({ timeout: 10000, force: true });
  await page.waitForTimeout(2000);
  if (!(await clicarMenuVisivel('Export data'))) fatal('menu "Export data" nao apareceu');
  await page.waitForTimeout(4000);

  // 5. captura o download
  const dlPromise = page.waitForEvent('download', { timeout: 240000 }).catch(() => null);
  await frame.getByText('Export', { exact: true }).first().click({ timeout: 8000 });
  logInfo('exportacao solicitada; aguardando download');

  let salvo = null;
  const dl = await dlPromise;
  if (dl) {
    try {
      await dl.saveAs(destino);
      salvo = destino;
      logInfo('download capturado via evento', { arquivo: destino });
    } catch (e) {
      // com setDownloadBehavior ativo o arquivo vai direto para a pasta,
      // sem artefato temporario — cai no fallback de varredura abaixo
      logInfo('saveAs falhou; procurando arquivo ja baixado', { erro: e.message.slice(0, 80) });
    }
  }
  if (!salvo) {
    // fallback: procura xlsx recente na pasta de downloads configurada e nas
    // pastas Downloads dos usuarios possiveis
    logInfo('varrendo pastas de download');
    const pastas = [OUT_DIR,
      'C:\\Users\\xdatacenter\\Downloads',
      'C:\\Users\\Administrator\\Downloads',
      'C:\\Users\\csmoura1\\Downloads'];
    const fim = Date.now() + 240000;
    while (Date.now() < fim && !salvo) {
      for (const pasta of pastas) {
        let arqs = [];
        try {
          arqs = fs.readdirSync(pasta)
            .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('detalhe-'))
            .map((f) => ({ f, mt: fs.statSync(path.join(pasta, f)).mtimeMs }))
            .filter((a) => Date.now() - a.mt < 600000)
            .sort((a, b) => b.mt - a.mt);
        } catch { /* pasta nao existe */ }
        if (arqs.length) {
          fs.copyFileSync(path.join(pasta, arqs[0].f), destino);
          salvo = destino;
          logInfo('xlsx encontrado', { de: path.join(pasta, arqs[0].f) });
          break;
        }
      }
      if (!salvo) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!salvo) fatal('download do xlsx nao apareceu em 4 minutos');

  const bytes = fs.statSync(salvo).size;
  if (bytes < 10000) fatal('xlsx muito pequeno, provavelmente invalido', { bytes });

  // 6. volta ao relatorio (higiene para as outras extracoes)
  await frame.getByText('Back to report', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(5000);

  console.log(`ARQUIVO=${salvo}`);
  console.log(`BYTES=${bytes}`);
  process.exit(0);
})().catch((e) => fatal('excecao nao tratada', { erro: e.message.slice(0, 300) }));
