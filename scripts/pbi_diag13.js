// Diagnostico 13: Export data -> dialogo de exportacao.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  const frame = page.frames()[0];

  // se o menu nao estiver aberto, abre
  const mais = frame.locator('button[aria-label="More options"]').last();
  await mais.click({ timeout: 8000, force: true }).catch(() => {});
  await page.waitForTimeout(1500);

  const exp = frame.getByText('Export data', { exact: true }).first();
  await exp.click({ timeout: 8000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13k.png' });

  const dlg = await frame.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('[role="radio"], input[type="radio"]'))
      .map((r) => ({ label: (r.getAttribute('aria-label') || (r.closest('label') || {}).innerText || '').trim().slice(0, 80), checked: r.checked || r.getAttribute('aria-checked') }))
      .filter((x) => x.label);
    const botoes = Array.from(document.querySelectorAll('button'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || '').trim())
      .filter((t) => /export|cancel/i.test(t));
    return { radios, botoes };
  });
  console.log('DIALOG=' + JSON.stringify(dlg, null, 1));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
