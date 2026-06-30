// api/auth/callback.js
// Recebe o "code" depois que o cliente autoriza na Conta Azul, valida o state,
// e troca o code pelos tokens iniciais (que ficam salvos no Supabase).

import { exchangeCodeForTokens } from '../../lib/contaazul.js';

export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Código de autorização ausente.');
  }
  if (state !== process.env.CA_SETUP_SECRET) {
    return res.status(401).send('State inválido — possível tentativa não autorizada.');
  }

  try {
    await exchangeCodeForTokens(code);
    res.status(200).send(
      '<html><body style="font-family:system-ui;text-align:center;padding:60px;">' +
      '<h2>Conta conectada com sucesso</h2>' +
      '<p>Já pode fechar esta aba e voltar ao painel. Os dados vão carregar.</p>' +
      '</body></html>'
    );
  } catch (err) {
    res.status(500).send(`Erro ao conectar: ${err.message}`);
  }
}
