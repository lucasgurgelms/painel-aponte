// lib/contaazul.js
// Núcleo da integração com a API Conta Azul (v2).
// Responsável por: trocar o código de autorização por tokens, renovar o
// access_token automaticamente quando expira (a cada 1h), e fazer chamadas
// autenticadas. Os tokens ficam guardados no Supabase, nunca no front.

import { createClient } from '@supabase/supabase-js';

const AUTH_BASE = 'https://auth.contaazul.com';
const API_BASE = 'https://api-v2.contaazul.com/v1';

// Cliente Supabase com a SERVICE ROLE KEY — só no backend.
// Essa chave tem poder total no banco; jamais expor no front.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Identificador da conexão deste cliente no banco (permite multi-conta no futuro).
const ACCOUNT_KEY = process.env.CA_ACCOUNT_KEY || 'aponte';

// Header Basic exigido pela Conta Azul: base64(client_id:client_secret)
function basicAuthHeader() {
  const raw = `${process.env.CA_CLIENT_ID}:${process.env.CA_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

// ETAPA 2 do OAuth — troca o "code" recebido no callback pelos tokens iniciais.
// Chamada uma única vez, quando o cliente conecta a conta.
export async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.CA_REDIRECT_URI,
  });

  const res = await fetch(`${AUTH_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Falha ao trocar code por token: ${res.status} ${txt}`);
  }

  const data = await res.json();
  await saveTokens(data);
  return data;
}

// Salva (ou atualiza) os tokens no Supabase, com o instante de expiração calculado.
async function saveTokens(tokenData) {
  const expiresAt = Date.now() + (tokenData.expires_in - 60) * 1000; // 1min de folga

  const payload = {
    account_key: ACCOUNT_KEY,
    access_token: tokenData.access_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  // refresh_token só vem na primeira autorização; preserva o existente se ausente.
  if (tokenData.refresh_token) payload.refresh_token = tokenData.refresh_token;

  const { error } = await supabase
    .from('ca_tokens')
    .upsert(payload, { onConflict: 'account_key' });

  if (error) throw new Error(`Erro ao salvar tokens: ${error.message}`);
}

// Renova o access_token usando o refresh_token guardado.
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${AUTH_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Falha ao renovar token: ${res.status} ${txt}`);
  }

  const data = await res.json();
  await saveTokens(data);
  return data.access_token;
}

// Retorna um access_token válido — renova sozinho se estiver expirado.
export async function getValidAccessToken() {
  const { data, error } = await supabase
    .from('ca_tokens')
    .select('*')
    .eq('account_key', ACCOUNT_KEY)
    .single();

  if (error || !data) {
    throw new Error('Conta não conectada. Faça a autorização em /api/auth/start.');
  }

  if (Date.now() < data.expires_at) {
    return data.access_token; // ainda válido
  }
  return await refreshAccessToken(data.refresh_token); // expirado → renova
}

// Chamada autenticada genérica à API v2. Renova token e tenta de novo se der 401.
export async function caFetch(path, { method = 'GET', query, body } = {}) {
  let token = await getValidAccessToken();

  const url = new URL(`${API_BASE}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const doCall = (tk) => fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${tk}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await doCall(token);

  if (res.status === 401) {
    // token virou inválido no meio do caminho — força refresh e tenta 1x mais
    const { data } = await supabase
      .from('ca_tokens').select('refresh_token').eq('account_key', ACCOUNT_KEY).single();
    token = await refreshAccessToken(data.refresh_token);
    res = await doCall(token);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Conta Azul ${res.status}: ${txt}`);
  }

  // alguns endpoints retornam vazio
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export { ACCOUNT_KEY, AUTH_BASE };
