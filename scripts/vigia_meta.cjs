// Vigia da meta mensal de Perda de Receita.
//
// Existe porque a meta muda TODO mes e nada no pipeline sabe disso: o
// run_daily.js passa --manter-objetivos fixo, entao na virada o gerar_dados.py
// repete as metas do mes anterior e apenas escreve "AVISO: repetindo objetivos
// do mes anterior" no log. Foi assim que outubro/2026 passou dois dias
// publicando a meta de setembro (99.656/dia em vez de 108.192/dia).
//
// Roda todo dia de manha, antes do pipeline das 07:30, e fala no WhatsApp
// (numero pessoal do Christian) em tres situacoes:
//   1. nao existe metas/<ano>-<mes>.json para o mes corrente -> meta nao aplicada
//   2. existe, mas o dados.json nao confere com ele          -> divergencia
//   3. hoje e o ultimo dia do mes                            -> fechamento + proxima meta
// Fora disso fica calado, de proposito.
//
//   node scripts\vigia_meta.cjs            roda e avisa se precisar
//   node scripts\vigia_meta.cjs --dry      so mostra o que diria
//   node scripts\vigia_meta.cjs --forca    manda a mensagem de fechamento hoje (teste)
const fs = require('fs');
const path = require('path');

const RAIZ = 'C:/projetos/perdadereceita';
const DADOS = RAIZ + '/data/dados.json';
const LOG = RAIZ + '/logs/vigia_meta.log';

const DRY = process.argv.includes('--dry');
const FORCA = process.argv.includes('--forca');

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function registrar(nivel, msg, extra) {
  const linha = JSON.stringify(Object.assign({ ts: new Date().toISOString(), level: nivel, msg }, extra || {}));
  console.log(linha);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, linha + '\n', 'utf8');
  } catch (e) { /* log e melhor-esforco */ }
}

async function avisar(texto) {
  if (DRY) { console.log('\n--- DRY, mensagem que eu mandaria ---\n' + texto + '\n---'); return true; }
  const url = process.env.UAZAPI_URL;
  const tok = process.env.UAZAPI_TOKEN;
  const dest = process.env.MORDOMO_OWNER_NUMBER;
  if (!url || !tok || !dest) {
    registrar('error', 'sem credenciais para avisar (UAZAPI_URL/UAZAPI_TOKEN/MORDOMO_OWNER_NUMBER)');
    return false;
  }
  try {
    const r = await fetch(url.replace(/\/+$/, '') + '/send/text', {
      method: 'POST',
      headers: { token: tok, 'content-type': 'application/json' },
      body: JSON.stringify({ number: dest, text: texto }),
    });
    const corpo = await r.text();
    // HTTP 200 com "async":true quer dizer ENFILEIRADO, nao entregue.
    registrar(r.ok ? 'info' : 'error', 'resposta do uazapi', { status: r.status, corpo: corpo.slice(0, 180) });
    return r.ok;
  } catch (e) {
    registrar('error', 'falha ao avisar', { erro: String(e.message || e).slice(0, 200) });
    return false;
  }
}

(async () => {
  const dados = JSON.parse(fs.readFileSync(DADOS, 'utf8'));
  const m = dados.mesAtual;
  const mm = String(m.mes).padStart(2, '0');
  const arq = RAIZ + '/metas/' + m.ano + '-' + mm + '.json';
  const nomeMes = MESES[m.mes - 1];

  const hoje = new Date();
  const ultimoDiaDoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const ehUltimoDia = hoje.getDate() === ultimoDiaDoMes;
  const proxMes = MESES[hoje.getMonth() === 11 ? 0 : hoje.getMonth() + 1];

  // ---- 1. a meta do mes corrente nem existe ----
  if (!fs.existsSync(arq)) {
    registrar('error', 'meta do mes corrente nao aplicada', { mes: m.mes, ano: m.ano, esperado: arq });
    await avisar(
      '*Perda de Receita - meta nao aplicada*\n\n'
      + 'O painel esta em *' + nomeMes + '/' + m.ano + '* mas a meta desse mes nunca foi aplicada. '
      + 'Ele esta publicando a meta do mes anterior: *' + brl(m.metaDiaBrasil) + '/dia*.\n\n'
      + 'Me manda a tabela *REGIONAL | Venda | Meta* de ' + nomeMes + ' que eu aplico. '
      + 'A coluna que vale e a *Meta* (projecao de venda do mes).\n\n'
      + '_Vou repetir este aviso todo dia ate resolver._',
    );
    process.exit(2);
  }

  // ---- 2. existe: confere se o que esta publicado bate com o arquivo ----
  const cfg = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const chave = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
  const porChave = new Map(Object.entries(cfg.projVenda).map(([k, v]) => [chave(k), v]));
  const LABEL_REG = dados.LABEL_REG || {};

  const divergencias = [];
  let somaObjDia = 0;
  let somaObjMes = 0;
  for (const k of Object.keys(m.extra)) {
    const display = LABEL_REG[k] || k;
    const esperadoVenda = porChave.get(chave(display)) ?? porChave.get(chave(k));
    if (esperadoVenda === undefined) { divergencias.push(display + ': sem meta no arquivo'); continue; }
    const objMes = Math.round(esperadoVenda * cfg.fator);
    const objDia = Math.round(objMes / m.diasNoMes);
    somaObjDia += objDia;
    somaObjMes += objMes;
    const e = m.extra[k];
    if (e.projVenda !== esperadoVenda) divergencias.push(display + ': projVenda ' + e.projVenda + ' != ' + esperadoVenda);
    else if (e.objMes !== objMes) divergencias.push(display + ': objMes ' + e.objMes + ' != ' + objMes);
    else if (e.objDia !== objDia) divergencias.push(display + ': objDia ' + e.objDia + ' != ' + objDia);
  }
  if (m.metaDiaBrasil !== somaObjDia) divergencias.push('metaDiaBrasil ' + m.metaDiaBrasil + ' != ' + somaObjDia);

  if (divergencias.length) {
    registrar('error', 'meta publicada divergente do arquivo', { arq, divergencias: divergencias.slice(0, 12) });
    await avisar(
      '*Perda de Receita - meta divergente*\n\n'
      + 'O que o painel publica nao bate com a meta de ' + nomeMes + ' que esta registrada.\n\n'
      + divergencias.slice(0, 6).map((d) => '- ' + d).join('\n')
      + (divergencias.length > 6 ? '\n- ... e mais ' + (divergencias.length - 6) : '')
      + '\n\nProvavelmente o pipeline sobrescreveu. Me chama que eu reaplico.',
    );
    process.exit(3);
  }

  registrar('info', 'meta do mes confere', { mes: m.mes, ano: m.ano, metaDia: m.metaDiaBrasil });

  // ---- 3. ultimo dia do mes: fechamento + meta do mes que vem ----
  if (ehUltimoDia || FORCA) {
    const acum = Object.keys(m.extra).reduce((a, k) => a + m.extra[k].acum, 0);
    const proj = m.ultimoDia ? Math.round((acum / m.ultimoDia) * m.diasNoMes) : 0;
    await avisar(
      '*Perda de Receita - fecha hoje*\n\n'
      + 'Hoje e o ultimo dia de *' + nomeMes + '*. Duas coisas:\n\n'
      + '1. *Fechamento de ' + nomeMes + '* - me chama que eu monto o comentario do mes '
      + 'para voce mandar no grupo. Projecao no momento: *' + brl(proj) + '* '
      + 'contra meta de *' + brl(somaObjMes) + '*.\n\n'
      + '2. *Meta de ' + proxMes + '* - me manda a tabela *REGIONAL | Venda | Meta*. '
      + 'Sem ela o painel vira o mes repetindo a meta de ' + nomeMes + ' e ninguem percebe.\n\n'
      + '_Avisado automaticamente no ultimo dia de cada mes._',
    );
    process.exit(0);
  }

  // dia comum e tudo certo: nao incomoda
  if (DRY) console.log('(nada a avisar hoje: a meta confere e nao e o ultimo dia do mes)');
  process.exit(0);
})().catch((e) => {
  registrar('error', 'vigia falhou', { erro: String(e.message || e).slice(0, 300) });
  process.exit(1);
});
