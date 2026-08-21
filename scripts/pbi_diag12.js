// Diagnostico 12: "More options" da visao show-as-table -> Export data?
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  const frame = page.frames()[0];

  // o botao "More options" da visao tabular fica perto do "Back to report"
  const mais = frame.locator('button[aria-label="More options"]').last();
  await mais.click({ timeout: 10000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13j.png' });

  const menu = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button, button, li'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\n/g, ' '))
      .filter((t) => t.length > 1 && t.length < 60)
      .slice(0, 25);
  });
  console.log('MENU=' + JSON.stringify(menu));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
