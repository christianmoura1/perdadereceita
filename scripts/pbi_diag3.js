// Diagnostico 3: aba 13. Tabela de Extracao — visuais e menu de exportacao.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  // clica na aba 13
  const aba = frame.locator('text=/13\\. Tabela de Extra/i').first();
  await aba.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
  await aba.click({ timeout: 10000 });
  await page.waitForTimeout(15000);
  console.log('ABA_13_CLICADA');

  // lista visuais
  const visuais = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('visual-container, [class*="visualContainer"], .visual'))
      .slice(0, 20)
      .map((v) => ({
        classe: (v.className || '').toString().slice(0, 60),
        texto: (v.innerText || '').replace(/\n/g, ' | ').slice(0, 120),
      }));
  });
  console.log('VISUAIS=' + JSON.stringify(visuais, null, 1).slice(0, 2000));

  // tenta achar o maior visual (a tabela) e passar o mouse para revelar o "..."
  const alvo = frame.locator('visual-container, .visualContainerHost, .vcBodyHost').first();
  await alvo.hover({ timeout: 10000 }).catch((e) => console.log('hover falhou: ' + e.message.slice(0, 100)));
  await page.waitForTimeout(1500);

  // procura botao de mais opcoes
  const mais = frame.locator('button[aria-label*="More"], button[aria-label*="op"], [aria-label*="..."]').first();
  const temMais = await mais.count().catch(() => 0);
  console.log('BTN_MAIS=' + temMais);

  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13.png', fullPage: false });
  console.log('SCREENSHOT_SALVO');
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
