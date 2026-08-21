const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  for (const p of ctx.pages()) {
    const u = p.url();
    if (/powerbi|login\.microsoft|app\.powerbi/i.test(u)) {
      const txt = (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250);
      console.log('URL=' + u.slice(0, 110));
      console.log('TXT=' + txt);
      console.log('---');
    }
  }
  await browser.close();
})().catch(e => { console.error('ERRO: ' + e.message); process.exit(1); });
