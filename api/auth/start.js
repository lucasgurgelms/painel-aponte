// api/auth/start.js
// Inicia o fluxo OAuth. Protegido por uma chave (CA_SETUP_SECRET) para que só
// quem tem o link consiga disparar a autorização. O cliente acessa este endpoint
// uma vez, é redirecionado para a Conta Azul, loga e autoriza.

import { AUTH_BASE } from '../../lib/contaazul.js';

export default function handler(req, res) {
  const key = req.query.key;
  if (!key || key !== process.env.CA_SETUP_SECRET) {
    return res.status(401).json({ error: 'Chave de setup inválida.' });
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.CA_CLIENT_ID,
    redirect_uri: process.env.CA_REDIRECT_URI,
    scope: 'openid profile aws.cognito.signin.user.admin',
    // state simples para validar o retorno no callback
    state: process.env.CA_SETUP_SECRET,
  });

  res.redirect(`${AUTH_BASE}/login?${params.toString()}`);
}
