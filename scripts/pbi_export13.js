// pbi_export13.js — Extrator de Perda de Receita pela aba "13. Tabela de Extração".
//
// POR QUE ASSIM: o extrator anterior raspava visuais agregados e clicava no
// slicer Regional 11 vezes — frágil e intermitente (o slicer some do DOM).
// A aba 13 exporta a tabela CRUA em Excel, com a coluna "Perda de receita",
// já com os filtros oficiais do BI aplicados (MANUTENCAO / BKB / META).
// Com o dado linha a linha, todo agregado é calculado aqui, sem depender de
// nenhum visual. Validado em 20/08/2026: bate com o relatorio publicado.
//
// Requer: aba do relatorio (44db1b) aberta e logada no Chrome com CDP 9222.
// Uso: node scripts\pbi_export13.js   -> baixa downloads\aba13-AAAA-MM-DD.xlsx

const { chromium } = require('C:/projetos/certponto-report/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const ROOT = path.join('C:', 'projetos', 'perdadereceita');
const DIR = path.join(ROOT, 'downloads');

const ts = () => new Date().toISOString();
const info = (msg, extra) => console.log(JSON.stringify({ ts: ts(), level: 'info', msg, ...extra }));
const erro = (msg, extra) => console.error(JSON.stringify({ ts: ts(), level: 'error', msg, ...extra }));

(async () => {
  const browser = await chromium.connectOverCDP(CDP);

  // A aba certa pelo ID do relatorio. NAO usar 'app.powerbi.com': ha outras
  // abas de Power BI abertas (Gestao de Risco) e pegar a errada trava tudo.
  let page = null;
  for (const c of browser.contexts()) for (const p of c.pages()) {
    if (p.url().includes('44db1b')) page = p;
  }
  if (!page) throw new Error('aba do Perda de Receita (44db1b) nao esta aberta no Chrome');
  if (/login\.microsoftonline|oauth2/.test(page.url())) {
    throw new Error('a aba esta na tela de login — relogar no Power BI pelo RDP');
  }
  info('aba encontrada');

  // 1. vai para a aba 13
  const a13 = page.locator('text=/13\\. Tabela de Extra/i').first();
  if (!(await a13.count())) throw new Error('pagina "13. Tabela de Extracao" nao encontrada no menu');
  await a13.click({ force: true }).catch(() => {});
  await page.waitForTimeout(8000);
  info('na aba 13');

  // 2. abre o menu do visual (o botao so aparece com o mouse sobre a tabela)
  await page.locator('.mid-viewport').first().hover().catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('button[aria-label*="More options"]').last()
    .click({ force: true }).catch(() => {});
  await page.waitForTimeout(2500);

  const exportar = page.getByText('Export data', { exact: true }).first();
  if (!(await exportar.count())) throw new Error('opcao "Export data" nao apareceu no menu do visual');
  await exportar.click({ force: true }).catch(() => {});
  await page.waitForTimeout(4500);
  info('dialogo de exportacao aberto');

  // 3. dispara o download. "Data with current layout" (padrao) ja traz a coluna
  //    "Perda de receita" — confirmado em 20/08/2026.
  fs.mkdirSync(DIR, { recursive: true });
  const destino = path.join(DIR, 'aba13-' + new Date().toISOString().slice(0, 10) + '.xlsx');

  const botao = page.locator('button').filter({ hasText: /^Export$/ }).last();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 240000 }),
    botao.click({ force: true }),
  ]);
  await dl.saveAs(destino);

  const bytes = fs.statSync(destino).size;
  if (bytes < 10000) throw new Error(`export saiu pequeno demais (${bytes} bytes) — provavelmente vazio`);
  info('export concluido', { arquivo: destino, bytes });

  // fecha o dialogo se ficou aberto, para nao atrapalhar a proxima rodada
  await page.keyboard.press('Escape').catch(() => {});
  await browser.close();
  console.log(destino);
})().catch((e) => { erro('export falhou', { erro: e.message }); process.exit(1); });
