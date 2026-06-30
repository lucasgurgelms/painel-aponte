// lib/auth.js
// Autenticação/autorização compartilhada pelos endpoints. Valida o token do
// Supabase (enviado pelo front no header Authorization) e resolve o papel do
// usuário a partir da tabela `perfis`. A trava real fica AQUI no servidor —
// o front só esconde botões; isto impede acesso direto à API sem login.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retorna { id, email, papel } do usuário logado, ou null se o token for inválido.
export async function getUsuario(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  // vincula por id; se não houver perfil ainda, tenta por e-mail (pré-cadastro).
  let { data: perfil } = await supabase
    .from('perfis').select('papel').eq('id', data.user.id).maybeSingle();
  if (!perfil && data.user.email) {
    const r = await supabase.from('perfis').select('papel').eq('email', data.user.email).maybeSingle();
    perfil = r.data;
  }
  return { id: data.user.id, email: data.user.email, papel: perfil?.papel || 'usuario' };
}

export function podeEditar(u) {
  return !!u && (u.papel === 'admin' || u.papel === 'financeiro');
}

// Helper p/ endpoints: garante login. Responde 401 e retorna null se faltar.
export async function exigirLogin(req, res) {
  const u = await getUsuario(req);
  if (!u) { res.status(401).json({ error: 'Faça login para acessar.' }); return null; }
  return u;
}
