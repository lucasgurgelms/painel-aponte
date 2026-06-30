// api/metas.js
// CRUD simples das metas que o cliente digita no painel (orçamento por
// categoria, metas de campanha, plano salarial). Guardadas no Supabase.
// GET  /api/metas?tipo=orcamento        → lista as metas de um tipo
// POST /api/metas  { tipo, chave, valor, ano } → grava/atualiza uma meta

import { createClient } from '@supabase/supabase-js';
import { getUsuario, podeEditar } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACCOUNT = process.env.CA_ACCOUNT_KEY || 'aponte';

export default async function handler(req, res) {
  try {
    const usuario = await getUsuario(req);
    if (!usuario) return res.status(401).json({ error: 'Faça login para acessar.' });

    if (req.method === 'GET') {
      const { tipo, ano } = req.query;
      let q = supabase.from('metas').select('*').eq('account_key', ACCOUNT);
      if (tipo) q = q.eq('tipo', tipo);
      if (ano) q = q.eq('ano', Number(ano));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST') {
      if (!podeEditar(usuario)) return res.status(403).json({ error: 'Sem permissão para editar metas.' });
      const { tipo, chave, valor, ano } = req.body || {};
      if (!tipo || !chave) {
        return res.status(400).json({ error: 'Informe tipo e chave.' });
      }
      const { error } = await supabase.from('metas').upsert(
        {
          account_key: ACCOUNT,
          tipo,
          chave,
          valor: Number(valor) || 0,
          ano: Number(ano) || new Date().getFullYear(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_key,tipo,chave,ano' }
      );
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
