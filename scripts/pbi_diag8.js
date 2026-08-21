// Diagnostico 8: fechar popup, botao direito na tabela, menu de contexto.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  // fecha qualquer popup: clica numa area neutra (titulo do relatorio)
  await page.mouse.click(600, 150);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
  });
  if (!box) { console.log('VISUAL_NAO_ACHADO'); process.exit(1); }

  // botao direito no centro da tabela
  await page.mouse.move(box.x, box.y, { steps: 5 });
  await page.waitForTimeout(1000);
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13g.png' });

  const menu = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, button, [role="option"], li'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || '').trim().replace(/\n/g, ' '))
      .filter((t) => t.length > 1 && t.length < 60)
      .slice(0, 30);
  });
  console.log('MENU_CTX=' + JSON.stringify(menu));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
