const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMAGENS = ['1-resumo-mtd.png', '3-mudancas.png', '4-consolidado.png'];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function montarZip(entradas) {
  const locais = [], centrais = [];
  let offset = 0;
  for (const [nome, conteudo] of entradas) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comprimido = zlib.deflateRawSync(conteudo);
    const crc = crc32(conteudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(conteudo.length, 22); local.writeUInt16LE(nomeBuf.length, 26);
    locais.push(local, nomeBuf, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(conteudo.length, 24); central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(offset, 42); centrais.push(central, nomeBuf);
    offset += 30 + nomeBuf.length + comprimido.length;
  }
  const a = Buffer.concat(locais), b = Buffer.concat(centrais), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10); fim.writeUInt32LE(b.length, 12); fim.writeUInt32LE(a.length, 16);
  return Buffer.concat([a, b, fim]);
}

(async () => {
  const token = process.env.MORDOMO_HANDOFF_TOKEN;
  if (!token) throw new Error('MORDOMO_HANDOFF_TOKEN ausente');
  const commit = execFileSync('C:\\Program Files\\Git\\cmd\\git.exe', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const date = new Date().toISOString().slice(0, 10);
  const dados = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dados.json'), 'utf8'));
  const comment = fs.readFileSync(path.join(ROOT, 'comentario.txt'), 'utf8').trim();
  const imgs = IMAGENS.map((file) => {
    const conteudo = fs.readFileSync(path.join(ROOT, 'imagens', file));
    return { file, conteudo, sha256: crypto.createHash('sha256').update(conteudo).digest('hex') };
  });
  const manifesto = {
    schemaVersion: 1,
    idempotencyKey: `${date}:${commit}`,
    date,
    commit,
    destination: 'Testes',
    deployUrl: 'https://perdadereceita.vercel.app',
    values: dados.resumo || dados.meta || {},
    comment: comment.includes('\n') ? comment : `${comment}\n`,
    images: imgs.map((i) => ({ file: i.file, mimeType: 'image/png', sha256: i.sha256 })),
  };
  const zip = montarZip([
    ['handoff.json', Buffer.from(JSON.stringify(manifesto), 'utf8')],
    ...imgs.map((i) => [i.file, i.conteudo]),
  ]);
  const resp = await fetch('http://127.0.0.1:8787/v1/perda-receita/handoffs', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/zip',
      'x-handoff-destination': 'Testes',
      'idempotency-key': manifesto.idempotencyKey,
    },
    body: zip,
  });
  const corpo = await resp.text();
  if (!resp.ok) throw new Error(`Mordomo recusou handoff (${resp.status}): ${corpo.slice(0, 300)}`);
  console.log(corpo);
})().catch((e) => { console.error(e.message); process.exit(1); });
