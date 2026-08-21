// Diagnostico 4: slicer de datas + menu de exportacao da tabela detalhada.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  const aba = frame.locator('text=/13\\. Tabela de Extra/i').first();
  await aba.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  await aba.click({ timeout: 10000 });
  await page.waitForTimeout(15000);

  // 1) slicer de datas: inputs com formato de data
  const datas = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('input'))
      .map((i) => ({ valor: i.value, aria: (i.getAttribute('aria-label') || '').slice(0, 60) }))
      .filter((x) => x.valor && x.valor.includes('/'));
  });
  console.log('INPUTS_DATA=' + JSON.stringify(datas));

  // 2) hover no visual da tabela detalhada e abre o menu "..."
  const visual = frame.locator('visual-container-component', { hasText: 'Perda de receita detalhada' }).first();
  await visual.hover({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const btnMais = visual.locator('button[aria-label*="More"], button[aria-label*="more"], [aria-label*="options"], [aria-label*="Op"]').first();
  console.log('BTN_MAIS_COUNT=' + await visual.locator('button').count());
  const labels = await visual.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')).filter(Boolean));
  console.log('BOTOES_VISUAL=' + JSON.stringify(labels));
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13b.png' });
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
