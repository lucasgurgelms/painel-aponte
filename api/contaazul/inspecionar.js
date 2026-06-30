// api/contaazul/inspecionar.js
// Endpoint TEMPORÁRIO de diagnóstico. Protegido pela chave de setup.
// Modos:
//   (default)        schema cru de um item de cada origem
//   ?modo=inventario distinct de categorias e centros de custo + item em aberto
//   ?modo=endpoints  sonda endpoints candidatos (saldos/contas financeiras)

import { caFetch, getValidAccessToken } from '../../lib/contaazul.js';

async function quemEstaConectado() {
  try {
    const token = await getValidAccessToken();
    const r = await fetch('https://auth.contaazul.com/oauth2/userInfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const txt = await r.text();
    let body; try { body = JSON.parse(txt); } catch { body = txt; }
    return { status: r.status, body };
  } catch (err) { return { erro: err.message }; }
}

async function buscarComFallback(path, params) {
  try { return await caFetch(path, { method: 'GET', query: params }); }
  catch (_) { return await caFetch(path, { method: 'POST', body: params }); }
}

// Percorre todas as páginas de uma origem (cap de segurança).
async function todasPaginas(tipo, data_de, data_ate, maxPaginas = 30) {
  const path = `/financeiro/eventos-financeiros/${tipo}/buscar`;
  const itens = [];
  let pagina = 1;
  while (pagina <= maxPaginas) {
    const resp = await buscarComFallback(path, {
      pagina, tamanho_pagina: 100,
      data_vencimento_de: data_de, data_vencimento_ate: data_ate,
    });
    const lote = (resp && (resp.itens || resp.content || resp.data)) || [];
    itens.push(...lote);
    const total = Number(resp?.itens_totais ?? lote.length);
    if (lote.length === 0 || pagina * 100 >= total) break;
    pagina++;
  }
  return itens;
}

export default async function handler(req, res) {
  if (req.query.key !== process.env.CA_SETUP_SECRET) {
    return res.status(401).json({ error: 'Chave inválida.' });
  }
  const modo = req.query.modo || 'schema';
  const data_de = req.query.data_de || '2026-01-01';
  const data_ate = req.query.data_ate || '2026-12-31';

  try {
    if (modo === 'inventario') {
      const [receber, pagar] = await Promise.all([
        todasPaginas('contas-a-receber', data_de, data_ate),
        todasPaginas('contas-a-pagar', data_de, data_ate),
      ]);
      const cats = new Set(), centros = new Set(), status = new Set();
      let exemploAberto = null;
      const coletar = (arr, origem) => {
        for (const l of arr) {
          (l.categorias || []).forEach(c => cats.add(`${origem}\t${c?.nome}`));
          (l.centros_de_custo || []).forEach(c => centros.add(c?.nome));
          if (l.status_traduzido) status.add(l.status_traduzido);
          if (!exemploAberto && Number(l.nao_pago) > 0) exemploAberto = { origem, ...l };
        }
      };
      coletar(receber, 'receber'); coletar(pagar, 'pagar');
      return res.status(200).json({
        periodo: { data_de, data_ate },
        qtd: { receber: receber.length, pagar: pagar.length },
        categorias: [...cats].sort(),
        centros_de_custo: [...centros].filter(Boolean).sort(),
        status_distintos: [...status],
        exemplo_item_em_aberto: exemploAberto,
      });
    }

    if (modo === 'statustest') {
      const base = { pagina: 1, tamanho_pagina: 5, data_vencimento_de: '2026-01-01', data_vencimento_ate: '2027-12-31' };
      const filtros = [
        { nome: 'sem_filtro', extra: {} },
        { nome: 'status=PENDING', extra: { status: 'PENDING' } },
        { nome: 'status=EM_ABERTO', extra: { status: 'EM_ABERTO' } },
        { nome: 'status_traduzido=EM_ABERTO', extra: { status_traduzido: 'EM_ABERTO' } },
        { nome: 'situacao=EM_ABERTO', extra: { situacao: 'EM_ABERTO' } },
        { nome: 'apenas_em_aberto=true', extra: { apenas_em_aberto: true } },
        { nome: 'pago=false', extra: { pago: false } },
        { nome: 'somente_nao_pagos=true', extra: { somente_nao_pagos: true } },
      ];
      const out = {};
      for (const f of filtros) {
        try {
          const r = await buscarComFallback('/financeiro/eventos-financeiros/contas-a-receber/buscar', { ...base, ...f.extra });
          out[f.nome] = { itens_totais: r?.itens_totais };
        } catch (err) { out[f.nome] = { erro: String(err.message).slice(0, 80) }; }
      }
      return res.status(200).json({ obs: 'comparar itens_totais; o filtro certo reduz drasticamente vs sem_filtro', receber: out });
    }

    if (modo === 'endpoints') {
      const candidatos = [
        '/financeiro/contas-financeiras',
        '/financeiro/contas-financeiras/buscar',
        '/financeiro/contas',
        '/financeiro/saldos',
        '/conta-financeira',
        '/contas-financeiras',
      ];
      const out = {};
      for (const p of candidatos) {
        try {
          const r = await caFetch(p, { method: 'GET', query: { pagina: 1, tamanho_pagina: 5 } });
          out[p] = { ok: true, chaves: r && typeof r === 'object' ? Object.keys(r) : typeof r, amostra: Array.isArray(r?.itens) ? r.itens[0] : (Array.isArray(r) ? r[0] : r) };
        } catch (err) { out[p] = { ok: false, erro: err.message }; }
      }
      return res.status(200).json(out);
    }

    // default: schema cru
    const [receber, pagar] = await Promise.all([
      buscarComFallback('/financeiro/eventos-financeiros/contas-a-receber/buscar', { pagina: 1, tamanho_pagina: 5, data_vencimento_de: data_de, data_vencimento_ate: data_ate }),
      buscarComFallback('/financeiro/eventos-financeiros/contas-a-pagar/buscar', { pagina: 1, tamanho_pagina: 5, data_vencimento_de: data_de, data_vencimento_ate: data_ate }),
    ]);
    const amostra = r => (r?.itens || [])[0] || null;
    return res.status(200).json({
      conta_conectada: await quemEstaConectado(),
      receber: { itens_totais: receber?.itens_totais, chaves: amostra(receber) ? Object.keys(amostra(receber)) : [], exemplo: amostra(receber) },
      pagar: { itens_totais: pagar?.itens_totais, chaves: amostra(pagar) ? Object.keys(amostra(pagar)) : [], exemplo: amostra(pagar) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
