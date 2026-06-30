// api/config.js
// Expõe ao front apenas o que é seguro: a URL pública do Supabase e a anon key
// (que são públicas por design), além de um flag indicando se a conta Conta Azul
// já foi conectada. Nada de segredos aqui.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  let conectado = false;
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data } = await supabase
      .from('ca_tokens')
      .select('account_key')
      .eq('account_key', process.env.CA_ACCOUNT_KEY || 'aponte')
      .single();
    conectado = !!data;
  } catch (_) {
    conectado = false;
  }

  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    contaAzulConectada: conectado,
  });
}
