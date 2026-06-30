// api/contaazul/lancamentos.js
// Drill-down ("razão"): lista os lançamentos individuais de uma categoria num
// período, para a DRE analítica. Reusa buscarLancamentos e filtra por categoria.

import { buscarLancamentos } from '../../lib/analytics.js';
import { norm } from '../../lib/dre-config.js';
import { exigirLogin } from '../../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!await exigirLogin(req, res)) return;
    const { data_de, data_ate, regime = 'caixa', categoria } = req.query;
    if (!data_de || !data_ate) {
      return res.status(400).json({ error: 'Informe data_de e data_ate (YYYY-MM-DD).' });
    }

    const todos = await buscarLancamentos({ dataInicio: data_de, dataFim: data_ate, regime });
    const alvo = categoria ? norm(categoria) : null;
    const itens = (alvo ? todos.filter(l => norm(l.categoria) === alvo) : todos)
      .map(l => ({
        data: l.data,
        descricao: l.descricao,
        categoria: l.categoria,
        centro: (l.centrosCusto && l.centrosCusto[0]) || '',
        valor: l.valor,
        credito: l.credito,
        situacao: l.situacao,
      }))
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      categoria: categoria || null,
      qtd: itens.length,
      total: itens.reduce((s, x) => s + x.valor, 0),
      itens,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
