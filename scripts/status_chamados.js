// Cruza os chamados do Perda de Receita com o estado deles no SOMA (ServiceNow).
//
// POR QUE EXISTE: o detalhe do Perda de Receita ja' dizia QUAL chamado causou a
// perda (coluna "chamado", vinda da aba 13 do Power BI), mas nao dizia se ele
// ainda esta' aberto. Sem isso nao da' pra separar "perda que ja' passou" de
// "perda que ainda esta' sangrando".
//
// Saida: data/chamados-status.json
//   { geradoEm, total, encontrados, estados: {...}, mapa: { WO0031474: {...} } }
//
// Uso: node scripts\status_chamados.js [--olhar]

const { chromium } = require('C:/projetos/certponto-report/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const RAIZ = 'C:\\projetos\\perdadereceita';
const DETALHE = path.join(RAIZ, 'data', 'detalhe-mes.json');
const SAIDA = path.join(RAIZ, 'data', 'chamados-status.json');
const BASE = 'https://soma.zamp.com.br';
const LOTE = 120;
const OLHAR = process.argv.includes('--olhar');

// Estados que significam "acabou". Todo o resto conta como aberto.
// Casamento por PREFIXO e sem acento: o SOMA escreve "Cancelada" (feminino),
// "Encerrado concluido", e variacoes que uma lista fixa nao cobre.
const PREFIXOS_FECHADO = ['encerrad', 'fechad', 'cancel', 'closed', 'complete'];
const estaFechado = (est) => PREFIXOS_FECHADO.some((p) => semAcento(est).startsWith(p));

const ts = () => new Date().toISOString();
const info = (msg, extra) => console.log(JSON.stringify({ ts: ts(), level: 'info', msg, ...extra }));
const erro = (msg, extra) => console.error(JSON.stringify({ ts: ts(), level: 'error', msg, ...extra }));

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// CSV do ServiceNow: campos entre aspas podem conter virgula e aspas duplicadas.
function parseCSV(txt) {
  const linhas = [];
  let campo = '', linha = [], dentro = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (dentro) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else dentro = false; }
      else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.length > 1 || (l[0] || '').trim());
}

(async () => {
  const det = JSON.parse(fs.readFileSync(DETALHE, 'utf8'));
  const todos = new Set();
  let ocsTotal = 0, ocsMulti = 0, ocsSemNada = 0;
  for (const reg of Object.keys(det)) {
    const pd = det[reg].porDia || {};
    for (const dia of Object.keys(pd)) {
      for (const o of pd[dia].ocs || []) {
        ocsTotal++;
        // UMA ocorrencia pode citar VARIOS chamados: "WO0041674, WO0041677, WO0042500"
        const nums = String(o.chamado || '').toUpperCase().split(/[,;]+/)
          .map((x) => x.trim()).filter((x) => /^WO\d+$/.test(x));
        if (!nums.length) { ocsSemNada++; continue; }
        if (nums.length > 1) ocsMulti++;
        for (const n of nums) todos.add(n);
      }
    }
  }
  const lista = [...todos];
  info('chamados a consultar', {
    distintos: lista.length, ocorrencias: ocsTotal,
    ocorrencias_com_varios_chamados: ocsMulti, ocorrencias_sem_chamado: ocsSemNada,
  });
  if (!lista.length) { erro('nenhum chamado WO no detalhe'); process.exit(1); }

  let browser;
  for (let t = 1; t <= 3 && !browser; t++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 60000 }); }
    catch (e) { if (t === 3) { erro('CDP nao respondeu', { erro: e.message }); process.exit(1); } await new Promise((r) => setTimeout(r, 8000)); }
  }
  const paginas = [];
  for (const c of browser.contexts()) for (const p of c.pages()) paginas.push(p);
  const pg = paginas.find((p) => /soma\.zamp\.com\.br/i.test(p.url()));
  if (!pg) { erro('nenhuma aba do SOMA aberta'); await browser.close().catch(() => {}); process.exit(2); }

  const mapa = {};
  const estados = {};
  let baixados = 0;

  for (let i = 0; i < lista.length; i += LOTE) {
    const pedaco = lista.slice(i, i + LOTE);
    const url = BASE + '/wm_order_list.do?CSV&sysparm_display_value=true'
      + '&sysparm_fields=number,state,u_bk_stage,opened_at,closed_at,short_description'
      + '&sysparm_query=' + encodeURIComponent('numberIN' + pedaco.join(','));

    const r = await pg.evaluate(async (u) => {
      const resp = await fetch(u, { credentials: 'include' });
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = ''; const ch = 0x8000;
      for (let k = 0; k < bytes.length; k += ch) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + ch));
      return { status: resp.status, url: resp.url, b64: btoa(bin) };
    }, url);

    if (/login\.microsoftonline|saml2/i.test(r.url)) { erro('SOMA em tela de login -- relogar pelo RDP'); await browser.close().catch(() => {}); process.exit(3); }
    if (r.status !== 200) { erro('SOMA respondeu HTTP ' + r.status); await browser.close().catch(() => {}); process.exit(4); }

    const txt = Buffer.from(r.b64, 'base64').toString('latin1');
    const linhas = parseCSV(txt);
    const cab = (linhas[0] || []).map((h) => h.trim().toLowerCase());
    const col = (n) => cab.indexOf(n);
    for (const l of linhas.slice(1)) {
      const num = (l[col('number')] || '').trim().toUpperCase();
      if (!num) continue;
      const est = (l[col('state')] || '').trim();
      estados[est] = (estados[est] || 0) + 1;
      mapa[num] = {
        estado: est,
        aberto: !estaFechado(est),
        fase: (l[col('u_bk_stage')] || '').trim(),
        abertura: (l[col('opened_at')] || '').trim(),
        fechamento: (l[col('closed_at')] || '').trim(),
      };
      baixados++;
    }
    info('lote', { de: i + 1, ate: Math.min(i + LOTE, lista.length), acumulado: baixados });
  }

  await browser.close().catch(() => {});

  const naoAchados = lista.filter((c) => !mapa[c]);
  const abertos = Object.values(mapa).filter((v) => v.aberto).length;
  info('resumo', {
    pedidos: lista.length, encontrados: baixados, nao_encontrados: naoAchados.length,
    abertos, fechados: baixados - abertos,
  });
  info('estados encontrados', estados);
  if (naoAchados.length) info('exemplos nao encontrados', { amostra: naoAchados.slice(0, 5) });

  if (OLHAR) { info('modo olhar -- nao gravei'); process.exit(0); }

  fs.writeFileSync(SAIDA, JSON.stringify({
    geradoEm: ts(), total: lista.length, encontrados: baixados,
    abertos, fechados: baixados - abertos, estados, mapa,
  }, null, 1));
  info('gravado', { arquivo: SAIDA, bytes: fs.statSync(SAIDA).size });
  process.exit(0);
})().catch((e) => { erro('falhou', { erro: e.message }); process.exit(1); });
