// api/contaazul/lancamentos.js
// Drill-down ("razão"): lista os lançamentos individuais de uma categoria num
// período, para a DRE analítica. Reusa buscarLancamentos e filtra por categoria.

import { buscarLancamentos } from '../../lib/analytics.js';
import { norm } from '../../lib/dre-config.js';
import { exigirLogin } from '../../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!await exigirLogin(req, res)) return;
    const { data_de, data_ate, regime = 'caixa', categoria, categorias, centro } = req.query;
    if (!data_de || !data_ate) {
      return res.status(400).json({ error: 'Informe data_de e data_ate (YYYY-MM-DD).' });
    }

    // Aceita uma categoria única (categoria) ou uma lista (categorias, separada por "||").
    let conjunto = null;
    if (categorias) conjunto = new Set(categorias.split('||').map(norm).filter(Boolean));
    else if (categoria) conjunto = new Set([norm(categoria)]);
    const centroAlvo = centro ? norm(centro) : null;

    const todos = await buscarLancamentos({ dataInicio: data_de, dataFim: data_ate, regime });
    const itens = todos
      .filter(l => !conjunto || conjunto.has(norm(l.categoria)))
      .filter(l => !centroAlvo || (l.centrosCusto || []).some(c => norm(c) === centroAlvo))
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
