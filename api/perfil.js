// api/perfil.js
// Papéis de usuário (admin | financeiro | usuario).
// GET  /api/perfil              → papel do usuário logado (valida o token Supabase)
// GET  /api/perfil?listar=1     → admin: lista todos os perfis
// POST /api/perfil { email, papel, nome, convidar } → admin: define papel / convida
//
// A autorização é feita aqui no backend com a SERVICE ROLE (que ignora RLS); o
// token do usuário é validado por supabase.auth.getUser(token).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const ACCOUNT = process.env.CA_ACCOUNT_KEY || 'aponte';

async function getCaller(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: perfil } = await supabase
    .from('perfis').select('papel').eq('id', data.user.id).single();
  return { id: data.user.id, email: data.user.email, papel: perfil?.papel || 'usuario' };
}

export default async function handler(req, res) {
  try {
    const caller = await getCaller(req);
    if (!caller) return res.status(401).json({ error: 'Não autenticado.' });

    if (req.method === 'GET') {
      if (req.query.listar) {
        if (caller.papel !== 'admin') return res.status(403).json({ error: 'Apenas admin.' });
        const { data, error } = await supabase
          .from('perfis').select('email, papel, nome').eq('account_key', ACCOUNT).order('email');
        if (error) throw new Error(error.message);
        return res.status(200).json({ papel: caller.papel, perfis: data || [] });
      }
      return res.status(200).json({ email: caller.email, papel: caller.papel,
        podeEditar: caller.papel === 'admin' || caller.papel === 'financeiro' });
    }

    if (req.method === 'POST') {
      if (caller.papel !== 'admin') return res.status(403).json({ error: 'Apenas admin pode gerenciar usuários.' });
      const { email, papel = 'usuario', nome = '', convidar = false } = req.body || {};
      if (!email) return res.status(400).json({ error: 'Informe o e-mail.' });
      if (!['admin', 'financeiro', 'usuario'].includes(papel)) return res.status(400).json({ error: 'Papel inválido.' });

      // Já existe perfil com esse e-mail? Então só atualiza o papel.
      const { data: existente } = await supabase.from('perfis').select('id').eq('email', email).maybeSingle();
      if (existente) {
        await supabase.from('perfis').update({ papel, nome, updated_at: new Date().toISOString() }).eq('id', existente.id);
        return res.status(200).json({ ok: true, acao: 'papel_atualizado' });
      }

      if (!convidar) {
        return res.status(409).json({ error: 'Usuário ainda não existe. Marque "convidar" para criar o acesso.' });
      }
      // Convida (cria o usuário no Supabase Auth; envia e-mail p/ definir senha).
      const { data: inv, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email);
      if (invErr) return res.status(502).json({ error: `Falha ao convidar: ${invErr.message}`, dica: 'O envio de e-mail depende da configuração SMTP do Supabase.' });
      await supabase.from('perfis').upsert({
        id: inv.user.id, email, papel, nome, account_key: ACCOUNT, updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      return res.status(200).json({ ok: true, acao: 'convidado' });
    }

    res.status(405).json({ error: 'Método não permitido.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
