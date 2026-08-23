const fs = require('fs');
const path = require('path');
const { verifySession } = require('../lib/auth');

const FILES = {
  dados: 'dados.json',
  detalhe: 'detalhe-mes.json',
};

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Metodo nao permitido' });
  if (!verifySession(req)) return res.status(401).json({ error: 'Nao autorizado' });

  const file = FILES[req.query.file];
  if (!file) return res.status(404).json({ error: 'Arquivo nao encontrado' });

  try {
    const contents = fs.readFileSync(path.join(process.cwd(), 'data', file), 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(contents);
  } catch (error) {
    console.error('Falha ao ler dados:', error.message);
    return res.status(500).json({ error: 'Dados indisponiveis' });
  }
};
