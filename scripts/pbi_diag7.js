// Diagnostico 7: fechar calendario, hover na tabela, abrir "..." e listar menu.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // centro do visual da tabela (parte inferior, longe do header/slicers)
  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7, w: r.width, h: r.height };
  });
  console.log('BOX=' + JSON.stringify(box));
  await page.mouse.move(box.x, box.y, { steps: 5 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13e.png' });

  // todos os botoes do documento (visiveis) com aria-label
  const botoes = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.getAttribute('aria-label') || b.title || '').trim())
      .filter((t) => t.length > 0 && t.length < 60)
      .slice(0, 40);
  });
  console.log('BOTOES_DOC=' + JSON.stringify(botoes));

  // tenta clicar no "More options"
  const mais = frame.locator('button[aria-label*="More options" i], [role="button"][aria-label*="More options" i]').first();
  const n = await mais.count();
  console.log('MORE_COUNT=' + n);
  if (n > 0) {
    await mais.click({ timeout: 8000, force: true });
    await page.waitForTimeout(2000);
    const itens = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] *, .mat-menu-item, button'))
        .filter((b) => b.offsetParent !== null)
        .map((b) => (b.innerText || '').trim())
        .filter((t) => t.length > 0 && t.length < 50)
        .slice(0, 30);
    });
    console.log('MENU=' + JSON.stringify(itens));
    await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13f.png' });
  }
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
