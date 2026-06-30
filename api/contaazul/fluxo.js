// api/contaazul/fluxo.js
// Dados de FLUXO e itens EM ABERTO (nao_pago > 0), que o analytics (focado em
// DRE/realizado) não cobre. Alimenta as abas "Campanhas e eventos" (a receber
// futuro por centro) e "Fluxo e patrimônio" (projeção 30/60/90, créditos a
// receber, investimentos a pagar, movimentações, contas bancárias).

import { caFetch } from '../../lib/contaazul.js';
import { norm, foraDaDRE, unidadeDoCentroCusto } from '../../lib/dre-config.js';

const DIA = 86400000;

// Busca paginada SÓ dos itens em aberto (status=EM_ABERTO filtra na API — passa
// de milhares para ~centenas, evitando o timeout de 30s da função).
async function buscar(tipo, de, ate, maxPag = 15) {
  const path = `/financeiro/eventos-financeiros/${tipo}/buscar`;
  const itens = [];
  let pagina = 1, total = 0;
  while (pagina <= maxPag) {
    const params = { pagina, tamanho_pagina: 100, data_vencimento_de: de, data_vencimento_ate: ate, status: 'EM_ABERTO' };
    let resp;
    try { resp = await caFetch(path, { method: 'GET', query: params }); }
    catch (_) { resp = await caFetch(path, { method: 'POST', body: params }); }
    const lote = (resp && (resp.itens || resp.content || resp.data)) || [];
    itens.push(...lote);
    total = Number(resp?.itens_totais ?? itens.length);
    if (lote.length === 0 || pagina * 100 >= total) break;
    pagina++;
  }
  return { itens, truncado: itens.length < total };
}

const iso = d => d.toISOString().slice(0, 10);
const mesChave = s => (s || '').slice(0, 7); // YYYY-MM
function centroNomes(l) {
  return (l.centros_de_custo || []).map(c => c?.nome).filter(Boolean);
}

export default async function handler(req, res) {
  try {
    const hoje = req.query.hoje ? new Date(req.query.hoje + 'T00:00:00') : new Date();
    const dias = Number(req.query.dias) || 365;
    const desde = new Date(hoje.getTime() - 90 * DIA); // inclui vencidos recentes
    const ate = new Date(hoje.getTime() + dias * DIA);

    const [rec, pag] = await Promise.all([
      buscar('contas-a-receber', iso(desde), iso(ate)),
      buscar('contas-a-pagar', iso(desde), iso(ate)),
    ]);

    // Só o que está em aberto (parcial ou total).
    const abertosRec = rec.itens.filter(l => Number(l.nao_pago) > 0);
    const abertosPag = pag.itens.filter(l => Number(l.nao_pago) > 0);

    // Bucket de projeção por dias até o vencimento, a partir de hoje.
    const novoBuckets = () => ({ vencido: 0, d30: 0, d60: 0, d90: 0, futuro: 0, total: 0 });
    function classificar(buckets, l) {
      const v = Number(l.nao_pago) || 0;
      const venc = l.data_vencimento ? new Date(l.data_vencimento + 'T00:00:00') : null;
      const dd = venc ? Math.floor((venc - hoje) / DIA) : 9999;
      if (dd < 0) buckets.vencido += v;
      else if (dd <= 30) buckets.d30 += v;
      else if (dd <= 60) buckets.d60 += v;
      else if (dd <= 90) buckets.d90 += v;
      else buckets.futuro += v;
      buckets.total += v;
    }
    const projRec = novoBuckets(), projPag = novoBuckets();
    abertosRec.forEach(l => classificar(projRec, l));
    abertosPag.forEach(l => classificar(projPag, l));

    // Agrupa nao_pago por mês de vencimento (entrada e saída).
    function porMes(arr) {
      const m = {};
      for (const l of arr) {
        const k = mesChave(l.data_vencimento);
        m[k] = (m[k] || 0) + (Number(l.nao_pago) || 0);
      }
      return Object.entries(m).map(([mes, valor]) => ({ mes, valor })).sort((a, b) => a.mes.localeCompare(b.mes));
    }

    // Agrupa a-receber em aberto por centro de custo (unidade) — útil p/ campanhas.
    function porCentro(arr) {
      const m = {};
      for (const l of arr) {
        const ccs = centroNomes(l);
        const lista = ccs.length ? ccs : [''];
        const fatia = (Number(l.nao_pago) || 0) / lista.length;
        for (const cc of lista) {
          const u = unidadeDoCentroCusto(cc);
          m[u] = (m[u] || 0) + fatia;
        }
      }
      return Object.entries(m).map(([unidade, valor]) => ({ unidade, valor })).sort((a, b) => b.valor - a.valor);
    }

    // Detalhe de itens em aberto (para listas), enxuto.
    const detalhe = arr => arr.map(l => ({
      descricao: l.descricao || '',
      categoria: l.categorias?.[0]?.nome || '',
      centro: centroNomes(l)[0] || '',
      vencimento: l.data_vencimento || null,
      total: Number(l.total) || 0,
      nao_pago: Number(l.nao_pago) || 0,
      pessoa: l.cliente?.nome || l.fornecedor?.nome || null,
    })).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));

    // Movimentações financeiras (fora da DRE) no período, a partir do realizado.
    // Aqui só sinalizamos contagem — o detalhe fino fica na DRE/memória.

    // Contas bancárias cadastradas (a API não expõe saldo — só metadados).
    let contas = [];
    try {
      const cf = await caFetch('/conta-financeira', { method: 'GET', query: { pagina: 1, tamanho_pagina: 50 } });
      contas = (cf?.itens || []).filter(c => c.ativo !== false).map(c => ({
        nome: c.nome, banco: c.banco, tipo: c.tipo, agencia: c.agencia, numero: c.numero,
      }));
    } catch (_) { /* sem acesso a contas */ }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      hoje: iso(hoje),
      janela: { de: iso(desde), ate: iso(ate) },
      truncado: rec.truncado || pag.truncado,
      projecao: { receber: projRec, pagar: projPag },
      aReceber: { porMes: porMes(abertosRec), porCentro: porCentro(abertosRec), itens: detalhe(abertosRec) },
      aPagar: { porMes: porMes(abertosPag), itens: detalhe(abertosPag) },
      contas,
      saldosDisponiveis: false, // a API v2 não expõe saldo por conta financeira
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
