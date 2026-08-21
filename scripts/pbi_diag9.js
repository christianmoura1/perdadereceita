// Diagnostico 9: submenu Copy -> Copy table? testa conteudo do clipboard.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  await page.mouse.click(600, 150); // fecha menus residuais
  await page.waitForTimeout(1200);

  const box = await frame.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.visualContainer, visual-container-component'));
    const v = vis.find((x) => (x.innerText || '').includes('BKN'));
    const r = v.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * 0.7 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.waitForTimeout(2000);

  // hover em "Copy"
  const copy = frame.getByText('Copy', { exact: true }).first();
  await copy.hover({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:\\projetos\\perdadereceita\\diag_aba13h.png' });

  const sub = await frame.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] *, button, li'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.innerText || '').trim().replace(/\n/g, ' '))
      .filter((t) => t.length > 1 && t.length < 60)
      .slice(0, 30);
  });
  console.log('SUBMENU=' + JSON.stringify(sub));

  // clica em "Copy table" se existir e tenta ler o clipboard
  const ct = frame.locator('text=/Copy table/i').first();
  if (await ct.count()) {
    await ct.click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    const clip = await frame.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch (e) { return 'CLIP_ERRO: ' + e.message; }
    });
    console.log('CLIP_LEN=' + (clip ? clip.length : 0));
    console.log('CLIP_INICIO=' + JSON.stringify((clip || '').slice(0, 300)));
    console.log('CLIP_FIM=' + JSON.stringify((clip || '').slice(-200)));
  } else {
    console.log('SEM_COPY_TABLE');
  }
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message.slice(0, 300)); process.exit(1); });
