// Diagnostico 6: slicer fim com click+type+Tab; hover via mouse real; menu ...
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  const aba = frame.locator('text=/13\\. Tabela de Extra/i').first();
  await aba.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  await aba.click({ timeout: 8000 }).catch(() => console.log("ABA_CLICK_SKIP (ja estava nela?)"));
  await page.waitForTimeout(15000);

  // 1) End date -> maximo
  const fim = frame.locator('input[aria-label*="End date"]').first();
  const aria = await fim.getAttribute('aria-label');
  const m = aria.match(/to (\d{1,2}\/\d{1,2}\/\d{4})/);
  const antes = await fim.inputValue().catch(() => null);
  console.log('FIM_ANTES=' + antes + ' MAX=' + (m && m[1]));
  if (m && antes !== m[1]) {
    await fim.click({ timeout: 8000, force: true });
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+a');
    await page.keyboard.type(m[1], { delay: 40 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(14000);
    console.log('FIM_DEPOIS=' + await fim.inputValue().catch(() => null));
  } else {
    console.log('SLICER_JA_OK');
  }

  // 2) hover com mouse real no centro do visual da tabela (indice 14)
  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    if (!v) return null;
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(60, r.height / 3) };
  });
  if (!box) { console.log('VISUAL_NAO_ACHADO'); process.exit(1); }
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(2000);

  // 3) lista botoes visiveis do header do visual
  const botoes = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    return Array.from(v.querySelectorAll('button, [role="button"], a'))
      .map((b) => b.getAttribute('aria-label') || b.title || '')
      .filter(Boolean);
  });
  console.log('BOTOES=' + JSON.stringify(botoes));
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13d.png' });
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
