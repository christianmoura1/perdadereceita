// Diagnostico 5: corrigir slicer fim -> maximo; abrir menu ... da tabela; listar itens.
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

  // 1) corrige o End date para o maximo disponivel
  const fim = frame.locator('input[aria-label*="End date"]').first();
  const aria = await fim.getAttribute('aria-label');
  const m = aria.match(/to (\d{1,2}\/\d{1,2}\/\d{4})/);
  console.log('ARIA_FIM=' + aria);
  if (m) {
    await fim.click({ timeout: 8000 });
    await fim.fill(m[1]);
    await fim.press('Enter');
    await page.waitForTimeout(12000);
    console.log('FIM_AJUSTADO=' + m[1]);
    const novo = await fim.getAttribute('value').catch(() => null);
    console.log('FIM_AGORA=' + novo);
  }

  // 2) visual da tabela: o visualContainer que contem "BKN" ou muitas linhas
  const visInfo = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    return vis.map((v, i) => ({
      i,
      classe: (v.className || '').toString().slice(0, 50),
      temDetalhada: (v.innerText || '').includes('detalhada'),
      temBKN: (v.innerText || '').includes('BKN'),
      chars: (v.innerText || '').length,
    })).filter((x) => x.chars > 50);
  });
  console.log('VISUAIS=' + JSON.stringify(visInfo));

  // 3) hover no visual da tabela e lista botoes do header
  const alvo = frame.locator('.visualContainer', { hasText: 'BKN' }).first();
  if (await alvo.count()) {
    await alvo.hover({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const botoes = await alvo.locator('button, [role="button"]').evaluateAll((bs) =>
      bs.map((b) => b.getAttribute('aria-label') || b.title || b.className).filter(Boolean).slice(0, 12));
    console.log('BOTOES=' + JSON.stringify(botoes));
    await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13c.png' });
  } else {
    console.log('VISUAL_TABELA_NAO_ACHADO');
  }
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
