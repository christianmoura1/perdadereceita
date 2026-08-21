// Diagnostico 10: "Show as a table" — o que abre? tem export? como e o DOM?
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  await page.mouse.click(600, 150);
  await page.waitForTimeout(1200);

  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForTimeout(2000);

  const show = frame.getByText('Show as a table', { exact: true }).first();
  await show.click({ timeout: 8000 });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13i.png' });

  const info = await frame.evaluate(() => {
    const botoes = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim())
      .filter((t) => t && t.length < 50).slice(0, 40);
    const roles = Array.from(document.querySelectorAll('[role="row"]')).length;
    const grids = Array.from(document.querySelectorAll('[role="grid"], [role="treegrid"], table')).length;
    return { botoes, roles, grids };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 2500));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
