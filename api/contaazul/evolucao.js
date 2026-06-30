// api/contaazul/evolucao.js
// Evolução mês a mês de um ano: entradas, saídas e resultado por mês.
// Usado na aba Orçamento → Evolução.

import { buscarLancamentos } from '../../lib/analytics.js';
import { exigirLogin } from '../../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!await exigirLogin(req, res)) return;
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const regime = req.query.regime || 'caixa';

    const lancamentos = await buscarLancamentos({
      dataInicio: `${ano}-01-01`,
      dataFim: `${ano}-12-31`,
      regime,
    });

    // Bucket por mês (1..12) — bruto, igual aos cards da visão geral.
    const meses = {};
    for (let m = 1; m <= 12; m++) meses[m] = { entradas: 0, saidas: 0 };
    for (const l of lancamentos) {
      // agrupa por vencimento (igual aos cards/DRE), não pela competência (que pode ser de anos atrás)
      const venc = String(l.vencimento || l.data || '');
      if (venc.slice(0, 4) !== String(ano)) continue; // ignora vencimentos fora do ano
      const mes = Number(venc.slice(5, 7));
      if (!mes || !meses[mes]) continue;
      if (l.credito) meses[mes].entradas += l.valor;
      else meses[mes].saidas += l.valor;
    }

    const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const serie = Object.entries(meses).map(([m, v]) => ({
      mes: NOMES[Number(m) - 1],
      entradas: v.entradas,
      saidas: v.saidas,
      resultado: v.entradas - v.saidas,
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({ ano, serie });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
