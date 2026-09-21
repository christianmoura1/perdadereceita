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
//  5b. status_chamados.js  SOMA -> data/chamados-status.json (TOLERANTE)
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

function dataEsperadaISO() {
  if (process.env.PBI_EXPECTED_DATE) return process.env.PBI_EXPECTED_DATE;
  const hoje = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

// Le' o valor exatamente como o Power BI mostrou na tela, e o formato muda
// com o idioma da conta: pt-BR usa ponto como milhar e virgula como decimal
// ("R$ 2.481.078"); en usa virgula como milhar e ponto como decimal. Sem
// normalizar isso, "2.481.078" virava NaN (multiplos pontos nao sao numero
// valido em JS) e a guarda de cruzamento 04x13 bloqueava a publicacao.
function numeroMoeda(valor) {
  let s = String(valor || '').replace(/[^0-9.,-]/g, '');
  if (!s) return NaN;
  const pontos = (s.match(/\./g) || []).length;
  const virgulas = (s.match(/,/g) || []).length;
  if (pontos > 0 && virgulas > 0) {
    // os dois presentes: o que vier POR ULTIMO e' o separador decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (virgulas > 1) {
    s = s.replace(/,/g, '');            // "1,234,567" -> milhar en
  } else if (pontos > 1) {
    s = s.replace(/\./g, '');           // "2.481.078" -> milhar pt-BR
  } else if (virgulas === 1) {
    s = s.replace(',', '.');            // "1234,56" -> decimal pt-BR
  } else if (pontos === 1) {
    // UM ponto sozinho e' ambiguo. Com exatamente 3 digitos depois e' milhar
    // pt-BR ("R$ 325.716" = 325716); com 1 ou 2 e' decimal ("325.72").
    // Sem esta regra, "R$ 325.716" virava 325,716 e "R$ 2.481.078" virava NaN
    // -- foi o que produziu "tela=325.72" e "tela=invalido" no guard de
    // cruzamento 04x13 em 15/09/2026.
    const depois = s.length - s.lastIndexOf('.') - 1;
    if (depois === 3) s = s.replace('.', '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function ultimoResumoPbi() {
  const dir = path.join(ROOT, 'pbi_raw');
  const arquivos = fs.readdirSync(dir)
    .filter((n) => /^resumo-\d{8}\.json$/i.test(n))
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!arquivos.length) throw new Error('resumo do Power BI nao encontrado');
  return JSON.parse(fs.readFileSync(path.join(dir, arquivos[0].n), 'utf8'));
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
    // `rodar` concatena stdout + stderr, nessa ordem. O caminho do .xlsx sai
    // por console.log (stdout) e os logs de erro por console.error (stderr),
    // entao quando o export precisa de uma segunda tentativa as linhas de erro
    // ficam DEPOIS do caminho e o antigo `.pop()` devolvia um JSON. Em 23/08
    // isso jogou fora uma exportacao que ja tinha dado certo. Pega de tras
    // para frente a ultima linha que e' mesmo um arquivo .xlsx.
    const xlsx = saidaExport
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('{') && /\.xlsx$/i.test(l))
      .pop() ?? '';
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
    const esperada = dataEsperadaISO();
    const fechamento = String(ma.atualizadoEm || '');
    if (fechamento !== esperada) {
      throw new Error(`publicacao bloqueada: esperado fechamento ${esperada}, dados.json esta em ${fechamento || 'data ausente'}`);
    }

    // A pagina 04 e a pagina 13 guardam filtros independentes. Em 31/08 a
    // pagina 04 ficou em outro estado e devolveu R$ 984 mil / 0,30%, enquanto
    // o Excel da pagina 13 somava R$ 6,3 milhoes. Sem este cruzamento o numero
    // parecia valido e foi publicado. As duas fontes precisam fechar no real.
    const resumoPbi = ultimoResumoPbi();
    const totalTela = numeroMoeda(resumoPbi?.total?.perdaTotal);
    const totalExcel = Number(total);
    if (!Number.isFinite(totalTela) || Math.abs(totalTela - totalExcel) > 20) {
      throw new Error(
        `publicacao bloqueada: filtros das paginas 04 e 13 divergem ` +
        `(tela=${Number.isFinite(totalTela) ? totalTela.toFixed(2) : 'invalido'}, ` +
        `excel=${totalExcel.toFixed(2)})`,
      );
    }
    logInfo('referencia do BI', { dia: Number(dia), pctBrasil: Number(pct), totalBrasil: Number(total) });

    // 5. guarda de publicacao — agora COM o detalhe (a aba 13 fornece)
    rodar('verifica', PYTHON, ['verifica.py', '--dia', dia, '--pct', pct, '--total', total, '--tol', '20']);

    // 5b. situacao de cada chamado no SOMA -> data/chamados-status.json
    // TOLERANTE de proposito: se o SOMA estiver deslogado, o painel abre do
    // mesmo jeito e a coluna Situacao mostra "—". Nao vale travar a publicacao
    // do relatorio da manha por causa de um enriquecimento.
    rodar('status_chamados', NODE, ['scripts\\status_chamados.js'], { tolerante: true });

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

    // 8. Entrega persistente pelo Mordomo. O produtor apenas monta e aceita o
    // pacote; o worker resolve o grupo Testes, retoma cada parte e evita envio
    // duplicado depois de uma falha ou reinicio.
    rodar('handoff Mordomo', NODE, ['scripts/enviar_handoff.js']);

    logInfo('pipeline diario concluido com sucesso', { seg: Math.round((Date.now() - inicio) / 1000) });
    process.exit(0); // sem isso o processo fica pendurado (conexao CDP do Playwright
    // nao solta o event loop sozinha) -- mesmo bug ja corrigido no chamados/run_daily.cjs.
    // O pipeline TERMINA de verdade (git push e handoff ja rodaram), mas o processo
    // Node nunca retorna, entao toda chamada via SSH parece travar/nao completar.
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
