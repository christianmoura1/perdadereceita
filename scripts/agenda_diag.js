// Diagnostico: estrutura da aba Google Calendar no Chrome do VPS.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages().map((p) => p.url());
  console.log('ABAS=' + JSON.stringify(pages.map((u) => u.slice(0, 80)), null, 1));
  const page = ctx.pages().find((p) => p.url().includes('outlook.office.com/calendar'));
  if (!page) { console.log('ABA_CALENDARIO_NAO_ENCONTRADA'); process.exit(1); }
  console.log('URL=' + page.url().slice(0, 100));

  const r = await page.evaluate(() => {
    const out = {};
    // eventos costumam ter role="button" com aria-label descritivo, ou data-eventid
    const eventos = Array.from(document.querySelectorAll('[data-eventid], [role="button"][aria-label]'))
      .map((e) => (e.getAttribute('aria-label') || '').trim())
      .filter((t) => t.length > 5 && t.length < 200)
      .slice(0, 30);
    out.eventos = eventos;
    // cabecalho de data visivel
    const datas = Array.from(document.querySelectorAll('[role="columnheader"], [role="heading"], h1, h2'))
      .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim())
      .filter((t) => t && t.length < 80)
      .slice(0, 15);
    out.cabecalhos = datas;
    return out;
  });
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
