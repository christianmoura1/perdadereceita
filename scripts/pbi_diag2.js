// Diagnostico 2: mapear TODOS os conteineres rolaveis e achar o da tabela por-data.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  const r = await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const dataRe = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    const rolaveis = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 100)
      .map((d, idx) => ({
        idx,
        classe: (d.className || '').toString().slice(0, 80),
        scrollHeight: d.scrollHeight,
        clientHeight: d.clientHeight,
        datasVisiveis: d.innerText.split('\n').map((l) => l.trim()).filter((l) => dataRe.test(l)).slice(0, 25),
      }))
      .filter((x) => x.datasVisiveis.length >= 3);
    // para cada candidato, rolar ate o fim e reler datas
    for (const x of rolaveis) {
      const el = Array.from(document.querySelectorAll('div'))
        .filter((d) => d.scrollHeight > d.clientHeight + 40 && d.clientHeight > 100)[x.idx];
      el.scrollTop = el.scrollHeight;
      await sleep(1200);
      x.datasNoFim = el.innerText.split('\n').map((l) => l.trim()).filter((l) => dataRe.test(l)).slice(-8);
      el.scrollTop = 0;
      await sleep(500);
    }
    return rolaveis;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message); process.exit(1); });
