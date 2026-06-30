// api/auth/reconectar.js
// Reconexão da conta Conta Azul a partir do painel — só para admin logado.
// Não usa a chave de setup no front: a autorização é o papel admin (token Supabase).
// Retorna a URL de login/autorização do Conta Azul; o front navega até ela.

import { AUTH_BASE } from '../../lib/contaazul.js';
import { getUsuario } from '../../lib/auth.js';

export default async function handler(req, res) {
  const u = await getUsuario(req);
  if (!u) return res.status(401).json({ error: 'Faça login.' });
  if (u.papel !== 'admin') return res.status(403).json({ error: 'Apenas admin pode reconectar a conta.' });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.CA_CLIENT_ID,
    redirect_uri: process.env.CA_REDIRECT_URI,
    scope: 'openid profile aws.cognito.signin.user.admin',
    state: process.env.CA_SETUP_SECRET,
  });
  res.status(200).json({ url: `${AUTH_BASE}/login?${params.toString()}` });
}
