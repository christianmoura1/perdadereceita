// run_daily.js — Pipeline diario de Perda de Receita (VM 227).
//
// ARQUITETURA (reescrita em 20/08/2026):
//   O Excel da aba "13. Tabela de Extracao" e' a FONTE CRUA: 14 mil linhas com
//   Regional, BKN, Loja, Data, Hora, Canal, Motivo, Subcategoria, Chamados e
//   "Perda de receita" em R$, ja com os filtros oficiais do BI. Dele sai tudo:
//   valores, ocorrencias, hora pico, top lojas e categorias.
//   Da TELA vem apenas os % — REGRA INVIOLAVEL do projeto: pctTotal e os % por
//   regional vem do BI, nunca recalculados.
//
// Fluxo:
//   1. pbi_export13.js      aba 13 -> downloads/aba13-AAAA-MM-DD.xlsx
//   2. pbi_extract.js       aba 04 -> pbi_raw/resumo-*.json (os % do slicer)
//   3. resumo_para_pct.py   resumo -> pct.json
//   4. gerar_dados.py       Excel + pct -> data/dados.json + data/detalhe-mes.json
//   5. verifica.py          guarda de publicacao (COM detalhe)
//   6. gerar_relatorio.py + gerar_imagens.py
//   7. git add/commit/push (chave de deploy SSH)
//   8. WhatsApp: 4 PNGs + comentario
// Se qualquer etapa 1-5 falhar: NAO publica; envia WhatsApp de alerta.
//
// PRE-REQUISITO: a aba do relatorio (44db1b) aberta e LOGADA no Chrome com CDP
// 9222, com BKB e MANUTENCAO selecionados (senao o slicer traz regionais de
// outras marcas).
//
// Agendado como "PerdaReceita - Diario 0730" (SYSTEM). Uso manual:
//   node scripts\run_daily.js

const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const ROOT = 'C:\\projetos\\perdadereceita';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const PYTHON = 'C:\\Program Files\\Python311\\python.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const DESTINO = process.env.PR_DEST_NUMBER || '5541992572743';

const agora = () => new Date().toISOString();
const logInfo = (msg, extra) => console.log(JSON.stringify({ ts: agora(), level: 'info', msg, ...extra }));
const logErro = (msg, extra) => console.error(JSON.stringify({ ts: agora(), level: 'error', msg, ...extra }));

// env Machine nem sempre chega ao processo (SYSTEM/SSH) — le do registro.
function envMachine(nome) {
  if (process.env[nome]) return process.env[nome];
  try {
    const out = execSync(
      `reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v ${nome}`,
      { encoding: 'utf8' },
    );
    const m = out.split(/\r?\n/).find((l) => l.trim().startsWith(nome));
    if (m) return m.split(/\s{2,}/).pop().trim();
  } catch { /* variavel ausente */ }
  return null;
}

function rodar(rotulo, cmd, args, opcoes = {}) {
  const t0 = Date.now();
  logInfo('etapa iniciada', { etapa: rotulo });
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const saida = ((r.stdout || '') + (r.stderr || '')).trim();
  const seg = Math.round((Date.now() - t0) / 1000);
  logInfo('etapa concluida', { etapa: rotulo, exit: r.status, seg, saida: saida.slice(0, 900) });
  if (r.status !== 0 && !opcoes.tolerante) {
    throw new Error(`${rotulo} falhou (exit ${r.status}): ${saida.slice(-400)}`);
  }
  return saida;
}

async function uazapi(endpoint, corpo) {
  const url = envMachine('UAZAPI_URL').replace(/\/+$/, '');
  const token = envMachine('UAZAPI_TOKEN');
  const resp = await fetch(`${url}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(corpo),
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`uazapi ${endpoint} -> HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  return txt;
}

(async () => {
  const inicio = Date.now();
  logInfo('pipeline diario iniciado');

  try {
    // 1. Excel da aba 13 — a fonte crua
    const saidaExport = rodar('pbi_export13', NODE, ['scripts\\pbi_export13.js']);
    const xlsx = saidaExport.split(/\r?\n/).filter(Boolean).pop().trim();
    if (!fs.existsSync(xlsx)) throw new Error(`Excel nao encontrado: ${xlsx}`);

    // 2. os % oficiais, lidos da tela (aba 04)
    rodar('pbi_extract', NODE, ['scripts\\pbi_extract.js']);

    // 3. resumo -> pct.json
    rodar('resumo_para_pct', PYTHON, ['scripts\\resumo_para_pct.py']);

    // 4. Excel + % -> dados.json e detalhe-mes.json
    const saidaDados = rodar('gerar_dados', PYTHON,
      ['scripts\\gerar_dados.py', '--excel', xlsx, '--pct', 'pct.json', '--manter-objetivos']);

    // Parametros da guarda lidos do PROPRIO dados.json, nao raspados do stdout:
    // a saida do gerar_dados vem com acento corrompido no console do Windows e
    // qualquer regex sobre ela e' fragil.
    const dj = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dados.json'), 'utf8'));
    const ma = dj.mesAtual || {};
    const dia = String(ma.ultimoDia);
    const pct = String(ma.pctTotal);
    const total = String(Object.values(ma.extra || {}).reduce((s, e) => s + (e.acum || 0), 0).toFixed(0));
    if (!dia || dia === 'undefined' || !pct || pct === 'undefined' || Number(total) <= 0) {
      throw new Error(`dados.json sem referencia valida (dia=${dia} pct=${pct} total=${total})`);
    }
    logInfo('referencia do BI', { dia: Number(dia), pctBrasil: Number(pct), totalBrasil: Number(total) });

    // 5. guarda de publicacao — agora COM o detalhe (a aba 13 fornece)
    rodar('verifica', PYTHON, ['verifica.py', '--dia', dia, '--pct', pct, '--total', total, '--tol', '20']);

    // 6. relatorio e imagens
    rodar('gerar_relatorio', PYTHON, ['gerar_relatorio.py']);
    rodar('gerar_imagens', PYTHON, ['gerar_imagens.py']);

    // 7. git — publica o dashboard na Vercel
    if (fs.existsSync(path.join(ROOT, '.git'))) {
      try {
        rodar('git add', GIT, ['add', '-f', 'data', 'relatorio.html', 'imagens']);
        const hoje = new Date().toISOString().slice(0, 10);
        rodar('git commit', GIT, ['commit', '-m', `Perda de receita ${hoje} (pipeline automatico)`]);
        // Push por CHAVE DE DEPLOY (nao por token): a privada nasceu e vive na
        // VPS e o acesso e' so' deste repositorio. Barras NORMAIS no
        // GIT_SSH_COMMAND -- com barra invertida o git nao acha a chave e da
        // "Permission denied (publickey)".
        process.env.GIT_SSH_COMMAND =
          'ssh -i C:/Users/csmoura1/.ssh/deploy_perdadereceita -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new';
        rodar('git push', GIT, ['push', 'origin', 'HEAD']);
      } catch (e) {
        logErro('git falhou (dashboard nao publicado; WhatsApp segue)', { erro: e.message.slice(0, 300) });
      }
    }

    // 8. WhatsApp
    const dirImg = path.join(ROOT, 'imagens');
    const pngs = ['1-resumo-mtd.png', '2-comentario.png', '3-mudancas.png', '4-consolidado.png']
      .filter((n) => fs.existsSync(path.join(dirImg, n)));
    for (const nome of pngs) {
      const b64 = fs.readFileSync(path.join(dirImg, nome)).toString('base64');
      await uazapi('/send/media', { number: DESTINO, type: 'image', file: b64 });
      logInfo('imagem enviada', { arquivo: nome });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const coment = path.join(ROOT, 'comentario.txt');
    if (fs.existsSync(coment)) {
      const texto = fs.readFileSync(coment, 'utf8');
      await uazapi('/send/text', { number: DESTINO, text: texto });
      logInfo('comentario enviado', { chars: texto.length });
    }

    logInfo('pipeline diario concluido com sucesso', { seg: Math.round((Date.now() - inicio) / 1000) });
  } catch (e) {
    logErro('pipeline falhou', { erro: e.message.slice(0, 500), seg: Math.round((Date.now() - inicio) / 1000) });
    try {
      await uazapi('/send/text', {
        number: DESTINO,
        text: `Perda de Receita: o relatorio de hoje NAO saiu.\n\nMotivo: ${e.message.slice(0, 300)}\n\nNada foi publicado.`,
      });
      logInfo('alerta de falha enviado');
    } catch { /* sem WhatsApp, resta o log */ }
    process.exit(1);
  }
})();
