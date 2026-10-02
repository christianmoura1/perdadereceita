// Aplica as metas de venda de um mes ao mesAtual do dados.json.
// Generico: le o arquivo de metas em metas\<ano>-<mes>.json, entao todo mes
// basta criar o arquivo novo e rodar -- nao precisa de script por mes.
//
//   node scripts\aplica_metas.cjs metas\2026-10.json          (grava)
//   set DRY=1 && node scripts\aplica_metas.cjs metas\2026-10.json   (so mostra)
//
// Formula, validada contra agosto e setembro nos 11 regionais:
//   objMes = round(projVenda * fator)        fator = 0.0074
//   objDia = round(objMes / diasNoMes)       <- usa os dias do mes CORRENTE
//
// A coluna "Meta" da tabela corporativa (REGIONAL | Venda | Meta) e' o
// projVenda. A coluna "Venda" e' a venda realizada e NAO entra aqui.
//
// NAO toca em nada que ja foi lancado a partir do BI: acum, diaUlt, acumAntes,
// perdaLoja, pctMes, pctTotal, data[], brasilVals, ultimoDia, atualizadoEm.
const fs = require('fs');
const path = require('path');

const RAIZ = 'C:/projetos/perdadereceita';
const CAMINHO = RAIZ + '/data/dados.json';
const DRY = process.env.DRY === '1';

const arqMetas = process.argv[2];
if (!arqMetas) {
  console.error('uso: node scripts\aplica_metas.cjs metas\<ano>-<mes>.json');
  process.exit(1);
}
const abs = path.isAbsolute(arqMetas) ? arqMetas : path.join(RAIZ, arqMetas);
if (!fs.existsSync(abs)) { console.error('ABORTADO: nao achei ' + abs); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
const fator = cfg.fator;
if (!(fator > 0 && fator < 1)) { console.error('ABORTADO: fator invalido: ' + fator); process.exit(1); }

// Comparo nomes de regional por uma chave sem acento e sem espaco, porque o
// mesmo regional aparece escrito de formas diferentes (e ja' chegou mojibake
// de print e de console). Assim "BK E FOGO LESTE" casa com "BK É FOGO LESTE".
const chave = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

const metasPorChave = new Map();
for (const [nome, v] of Object.entries(cfg.projVenda)) {
  if (!Number.isFinite(v) || v <= 0) { console.error('ABORTADO: projVenda invalido para ' + nome + ': ' + v); process.exit(1); }
  metasPorChave.set(chave(nome), { nome, v });
}

// conferencia da soma contra o total do print, se foi informado
const somaInformada = [...metasPorChave.values()].reduce((a, x) => a + x.v, 0);
if (cfg.totalConferencia != null && somaInformada !== cfg.totalConferencia) {
  console.error('ABORTADO: soma das metas (' + somaInformada.toLocaleString('pt-BR') +
    ') nao bate com totalConferencia (' + cfg.totalConferencia.toLocaleString('pt-BR') + ')');
  process.exit(1);
}

const dados = JSON.parse(fs.readFileSync(CAMINHO, 'utf8'));
const m = dados.mesAtual;
if (m.mes !== cfg.mes || m.ano !== cfg.ano) {
  console.error('ABORTADO: mesAtual e ' + m.nome + '/' + m.ano + ' (mes=' + m.mes +
    '), mas o arquivo de metas e de ' + cfg.mes + '/' + cfg.ano);
  process.exit(1);
}
if (!(m.diasNoMes >= 28 && m.diasNoMes <= 31)) {
  console.error('ABORTADO: diasNoMes suspeito: ' + m.diasNoMes); process.exit(1);
}

// interno -> exibicao (SP CENTRO LITORAL aparece como BK E FOGO CENTRO LITORAL)
const LABEL_REG = dados.LABEL_REG || {};
const internos = Object.keys(m.extra);

// toda regional do dados.json tem que ter meta, e toda meta tem que ser usada
const usadas = new Set();
const linhas = [];
for (const k of internos) {
  const display = LABEL_REG[k] || k;
  const hit = metasPorChave.get(chave(display)) || metasPorChave.get(chave(k));
  if (!hit) {
    console.error('ABORTADO: sem meta para "' + display + '" (chave interna "' + k + '")');
    process.exit(1);
  }
  usadas.add(chave(hit.nome));
  const e = m.extra[k];
  const objMes = Math.round(hit.v * fator);
  const objDia = Math.round(objMes / m.diasNoMes);
  linhas.push({
    k, display, antes: { projVenda: e.projVenda, objMes: e.objMes, objDia: e.objDia },
    projVenda: hit.v, objMes, objDia, rest: e.rest,
  });
}
const sobrando = [...metasPorChave.values()].filter((x) => !usadas.has(chave(x.nome)));
if (sobrando.length) {
  console.error('ABORTADO: metas informadas que nao casaram com nenhuma regional: ' +
    sobrando.map((x) => x.nome).join(', '));
  process.exit(1);
}

console.log('=== ' + m.nome + '/' + m.ano + '  (' + m.diasNoMes + ' dias)  fator ' + fator + ' ===');
console.log('');
console.log('REGIONAL'.padEnd(27) + 'PROJ.VENDA'.padStart(14) + '   OBJ.MES'.padStart(12) + '   OBJ.DIA'.padStart(12) + '  lojas');
let sMes = 0, sDia = 0;
for (const l of linhas) {
  sMes += l.objMes; sDia += l.objDia;
  const mudou = l.antes.projVenda !== l.projVenda ? ' <-' : '   ';
  console.log(l.display.padEnd(27) +
    l.projVenda.toLocaleString('pt-BR').padStart(14) +
    l.objMes.toLocaleString('pt-BR').padStart(12) +
    l.objDia.toLocaleString('pt-BR').padStart(12) +
    String(l.rest).padStart(7) + mudou);
}
console.log('');
console.log('antes:  metaDiaBrasil = ' + Number(m.metaDiaBrasil).toLocaleString('pt-BR'));
console.log('depois: metaDiaBrasil = ' + sDia.toLocaleString('pt-BR') +
  '   (objMes somado: ' + sMes.toLocaleString('pt-BR') + ')');
console.log('soma projVenda: ' + somaInformada.toLocaleString('pt-BR'));
console.log('');
console.log('preservado (vem do BI): ultimoDia=' + m.ultimoDia + ' atualizadoEm=' + m.atualizadoEm + ' pctTotal=' + m.pctTotal);

if (DRY) { console.log(''); console.log('DRY-RUN: nao gravei nada.'); process.exit(0); }

for (const l of linhas) {
  const e = m.extra[l.k];
  e.projVenda = l.projVenda; e.objMes = l.objMes; e.objDia = l.objDia;
}
m.metaDiaBrasil = sDia;

const dirBkp = RAIZ + '/_backups';
fs.mkdirSync(dirBkp, { recursive: true });
const bkp = dirBkp + '/dados.json.antes-metas-' + cfg.ano + '-' + String(cfg.mes).padStart(2, '0');
fs.copyFileSync(CAMINHO, bkp);
fs.writeFileSync(CAMINHO, JSON.stringify(dados, null, 2), 'utf8');
console.log('');
console.log('GRAVADO: ' + CAMINHO);
console.log('backup:  ' + bkp);
