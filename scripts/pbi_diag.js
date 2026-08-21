// Diagnostico: estado da tabela por-data e do slicer de data no Chrome do VPS.
const { chromium } = require('C:\\projetos\\certponto-report\\node_modules\\playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('app.powerbi.com'));
  if (!page) { console.log('ABA_PBI_NAO_ENCONTRADA'); process.exit(1); }
  const frame = page.frames()[0];

  const r = await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const out = {};
    // 1) texto "Atualizado em"
    const bodyTxt = document.body.innerText;
    const m = bodyTxt.match(/Atualizado em[:\s]*([\d\/ :AMPM]+)/i);
    out.atualizadoEm = m ? m[1] : null;
    // 2) visual da tabela por-data
    const candidatos = Array.from(document.querySelectorAll('div'))
      .filter((d) => (d.innerText || '').includes('Perda de receita por data'))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    const visual = candidatos[0];
    if (!visual) { out.erro = 'visual por-data nao localizado (aba errada?)'; return out; }
    const sc = visual.querySelector('.scroll-content');
    out.temScrollContent = !!sc;
    if (sc) {
      out.scrollHeight = sc.scrollHeight;
      out.clientHeight = sc.clientHeight;
      // datas visiveis no topo
      const dataRe = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
      const datasTopo = sc.innerText.split('\n').map((l) => l.trim()).filter((l) => dataRe.test(l));
      out.datasTopo = datasTopo;
      // rola ate o fim e coleta datas do fim
      sc.scrollTop = sc.scrollHeight;
      await sleep(1200);
      const datasFim = sc.innerText.split('\n').map((l) => l.trim()).filter((l) => dataRe.test(l));
      out.datasFim = datasFim;
      sc.scrollTop = 0;
      await sleep(600);
    }
    // 3) slicers de data: procura inputs/textos com padrao de data fora da tabela
    const todos = Array.from(document.querySelectorAll('div, span, input'))
      .map((e) => (e.value || e.innerText || '').trim())
      .filter((t) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t));
    const uniq = [...new Set(todos)];
    out.datasNaPagina = uniq;
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.log('ERRO_FATAL: ' + e.message); process.exit(1); });
