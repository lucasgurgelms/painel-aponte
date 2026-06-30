// api/contaazul/inspecionar.js
// Endpoint TEMPORÁRIO de diagnóstico. Retorna uma amostra dos lançamentos crus
// e a lista de categorias e centros de custo distintos que vêm da API deste
// cliente. Serve para confirmarmos os nomes reais e ajustar o lib/dre-config.js.
// Protegido pela mesma chave de setup. Pode ser removido depois.

import { caFetch } from '../../lib/contaazul.js';

export default async function handler(req, res) {
  if (req.query.key !== process.env.CA_SETUP_SECRET) {
    return res.status(401).json({ error: 'Chave inválida.' });
  }

  try {
    const data_de = req.query.data_de || '2026-05-01';
    const data_ate = req.query.data_ate || '2026-05-31';

    const resp = await caFetch('/financeiro/eventos-financeiros/busca', {
      query: { pagina: 1, tamanho_pagina: 100, data_de, data_ate, regime: 'caixa' },
    });

    const itens = (resp && (resp.itens || resp.content || resp.data)) || [];

    // Coleta nomes distintos para conferência
    const categorias = new Set();
    const centrosCusto = new Set();
    const tipos = new Set();
    for (const l of itens) {
      const cat = l.categoria?.nome ?? l.categoria ?? l.category;
      if (cat) categorias.add(typeof cat === 'string' ? cat : JSON.stringify(cat));
      const cc = l.centros_custo ?? l.centrosCusto ?? l.centro_custo ?? l.costCenters;
      if (Array.isArray(cc)) cc.forEach(x => centrosCusto.add(typeof x === 'string' ? x : (x.nome ?? x.name ?? JSON.stringify(x))));
      else if (cc) centrosCusto.add(typeof cc === 'string' ? cc : JSON.stringify(cc));
      const tp = l.tipo_operacao ?? l.tipo ?? l.operationType;
      if (tp) tipos.add(tp);
    }

    res.status(200).json({
      total_itens_amostra: itens.length,
      chaves_do_primeiro_item: itens[0] ? Object.keys(itens[0]) : [],
      amostra_primeiro_item: itens[0] || null,
      categorias_distintas: [...categorias].sort(),
      centros_custo_distintos: [...centrosCusto].sort(),
      tipos_distintos: [...tipos],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
