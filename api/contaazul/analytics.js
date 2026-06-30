// api/contaazul/analytics.js
// Endpoint principal que o front consome. Recebe período e regime, busca os
// lançamentos e devolve tudo que as abas precisam num único payload.

import { buscarLancamentos } from '../../lib/analytics.js';
import {
  montarDRE, montarUnidades, montarReceitasDespesas, montarTotais,
} from '../../lib/analytics.js';
import { exigirLogin } from '../../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!await exigirLogin(req, res)) return;
    const {
      data_de,
      data_ate,
      regime = 'caixa',
    } = req.query;

    if (!data_de || !data_ate) {
      return res.status(400).json({ error: 'Informe data_de e data_ate (YYYY-MM-DD).' });
    }

    const lancamentos = await buscarLancamentos({
      dataInicio: data_de,
      dataFim: data_ate,
      regime,
    });

    const payload = {
      periodo: { data_de, data_ate, regime },
      sincronizadoEm: new Date().toISOString(), // instante da busca ao vivo na Conta Azul
      totais: montarTotais(lancamentos),
      dre: montarDRE(lancamentos),
      unidades: montarUnidades(lancamentos),
      receitasDespesas: montarReceitasDespesas(lancamentos),
      qtdLancamentos: lancamentos.length,
    };

    // cache curto para não estourar limite da API em refreshes seguidos
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
