// api/contaazul/inspecionar.js
// Endpoint TEMPORÁRIO de diagnóstico. Bate nos endpoints reais de busca da API
// v2 (contas a receber e a pagar) e devolve o schema cru: chaves do wrapper de
// paginação, chaves do primeiro item e uma amostra. Serve para confirmarmos os
// nomes reais dos campos e ajustar lib/analytics.js + lib/dre-config.js.
// Protegido pela mesma chave de setup. Pode ser removido depois.

import { caFetch } from '../../lib/contaazul.js';

// Tenta GET com query; se o endpoint exigir POST com corpo, tenta de novo.
async function sondar(path, params) {
  try {
    const resp = await caFetch(path, { method: 'GET', query: params });
    return { ok: true, metodo: 'GET', resp };
  } catch (errGet) {
    try {
      const resp = await caFetch(path, { method: 'POST', body: params });
      return { ok: true, metodo: 'POST', resp };
    } catch (errPost) {
      return { ok: false, erroGet: errGet.message, erroPost: errPost.message };
    }
  }
}

function resumir(resultado) {
  if (!resultado.ok) return resultado;
  const { resp, metodo } = resultado;
  const itens = (resp && (resp.itens || resp.content || resp.data || resp.items)) || [];
  return {
    ok: true,
    metodo,
    chaves_resposta: resp && typeof resp === 'object' ? Object.keys(resp) : [],
    itens_totais: resp ? resp.itens_totais : undefined,
    totais: resp ? resp.totais : undefined,
    total_itens_amostra: Array.isArray(itens) ? itens.length : 0,
    chaves_do_primeiro_item: itens[0] ? Object.keys(itens[0]) : [],
    amostra_primeiro_item: itens[0] || null,
  };
}

export default async function handler(req, res) {
  if (req.query.key !== process.env.CA_SETUP_SECRET) {
    return res.status(401).json({ error: 'Chave inválida.' });
  }

  try {
    const data_de = req.query.data_de || '2026-05-01';
    const data_ate = req.query.data_ate || '2026-05-31';

    // ?sem_filtro=1 → não envia filtro de data (pra saber se a conta tem dados
    // e descobrir o schema real de um item, independente do nome do param de data).
    const semFiltro = req.query.sem_filtro === '1';
    const params = semFiltro
      ? { pagina: 1, tamanho_pagina: 50 }
      : {
          pagina: 1,
          tamanho_pagina: 50,
          data_vencimento_de: data_de,
          data_vencimento_ate: data_ate,
        };

    const [receber, pagar] = await Promise.all([
      sondar('/financeiro/eventos-financeiros/contas-a-receber/buscar', params),
      sondar('/financeiro/eventos-financeiros/contas-a-pagar/buscar', params),
    ]);

    res.status(200).json({
      periodo: { data_de, data_ate },
      contas_a_receber: resumir(receber),
      contas_a_pagar: resumir(pagar),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
