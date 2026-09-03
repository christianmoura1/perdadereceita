const {
  createSession,
  safeEqual,
  sessionCookie,
} = require('../lib/auth');
const auth = require('../config/dashboard-auth.json');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo nao permitido' });

  try {
    const { username = '', password = '' } = req.body || {};
    const valid = safeEqual(username, auth.user || '')
      && safeEqual(password, auth.password || '');
    if (!valid) {
      return res.status(401).json({ error: 'Usuario ou senha incorretos' });
    }

    res.setHeader('Set-Cookie', sessionCookie(createSession(username)));
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Falha no login:', error.message);
    return res.status(500).json({ error: 'Configuracao indisponivel' });
  }
};
