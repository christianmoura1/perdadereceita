// Diagnostico 11: toolbar da visao "show as table" + estrutura das linhas.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  const frame = page.frames()[0];

  // botoes visiveis com aria-label (todos)
  const botoes = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"], a[role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.getAttribute('aria-label') || '').trim())
      .filter((t) => t && t.length < 70);
  });
  console.log('BOTOES=' + JSON.stringify(botoes));

  // estrutura de uma linha do grid
  const linha = await frame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    const r = rows.find((x) => (x.innerText || '').includes('BKB'));
    if (!r) return null;
    const cells = Array.from(r.querySelectorAll('[role="gridcell"], [role="columnheader"], td, div'))
      .map((c) => (c.innerText || '').trim()).filter((t) => t);
    return { tag: r.tagName, classe: (r.className || '').toString().slice(0, 60), cells: cells.slice(0, 15) };
  });
  console.log('LINHA=' + JSON.stringify(linha));

  // quantas linhas role=row e quantas com BKB
  const contas = await frame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="row"]'));
    return { total: rows.length, comBKB: rows.filter((x) => (x.innerText || '').includes('BKB')).length };
  });
  console.log('ROWS=' + JSON.stringify(contas));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
