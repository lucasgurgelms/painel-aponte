// lib/analytics.js
// Motor de análise. Busca os lançamentos financeiros da Conta Azul, aplica a
// regra de rateio (item com vários centros de custo divide igual entre eles),
// e produz as estruturas que cada aba do painel consome: DRE (sintética e
// analítica), resultado por unidade, receitas/despesas por categoria, e
// comparativo mês a mês.

import { caFetch } from './contaazul.js';
import {
  norm, grupoDaDespesa, grupoDaReceita, foraDaDRE, ehDeducao,
  unidadeDoCentroCusto, RECEITA_GRUPOS, DESPESA_GRUPOS, UNIDADES,
} from './dre-config.js';

// ---------------------------------------------------------------------------
// Busca de lançamentos financeiros num intervalo de datas. Receitas e despesas
// vêm de endpoints separados da API v2 (contas a receber/pagar), ambos paginados;
// aqui percorremos todas as páginas e juntamos tudo num formato único.
// ---------------------------------------------------------------------------
export async function buscarLancamentos({ dataInicio, dataFim, regime = 'caixa' }) {
  // Receitas (crédito) e despesas (débito) vêm de endpoints separados na API v2.
  // O sinal (crédito/débito) é definido pela ORIGEM, não por um campo do item.
  const [receitas, despesas] = await Promise.all([
    buscarEventos('contas-a-receber', { dataInicio, dataFim, regime }),
    buscarEventos('contas-a-pagar', { dataInicio, dataFim, regime }),
  ]);

  return [
    ...receitas.map(l => normalizarLancamento(l, true, regime)),
    ...despesas.map(l => normalizarLancamento(l, false, regime)),
  ];
}

// Busca paginada de um tipo de evento financeiro ('contas-a-receber' | 'contas-a-pagar').
// A API responde { itens_totais, itens, totais }. Paginamos até cobrir itens_totais.
async function buscarEventos(tipo, { dataInicio, dataFim, regime }) {
  const path = `/financeiro/eventos-financeiros/${tipo}/buscar`;
  const tamanho = 100;
  const todos = [];
  let pagina = 1;

  // Filtra o período por data de vencimento (param confirmado da API). O regime
  // muda só qual VALOR é considerado em cada item (pago x total), não o filtro.
  const filtroData = { data_vencimento_de: dataInicio, data_vencimento_ate: dataFim };

  while (true) {
    const params = { pagina, tamanho_pagina: tamanho, ...filtroData };
    const resp = await buscarComFallback(path, params);

    const itens = (resp && (resp.itens || resp.content || resp.data)) || [];
    todos.push(...itens);

    const total = Number(resp?.itens_totais ?? itens.length);
    if (itens.length === 0 || pagina * tamanho >= total) break;
    pagina++;
  }
  return todos;
}

// Alguns endpoints de busca da API v2 aceitam GET com query; outros exigem POST
// com corpo. Tenta GET e cai para POST se necessário.
async function buscarComFallback(path, params) {
  try {
    return await caFetch(path, { method: 'GET', query: params });
  } catch (_) {
    return await caFetch(path, { method: 'POST', body: params });
  }
}

// Padroniza um lançamento cru da API v2 para o formato interno que o motor usa.
// ehCredito vem da ORIGEM (contas a receber = crédito; a pagar = débito).
// Formato real confirmado via /api/contaazul/inspecionar:
//   total, pago, nao_pago (números); status / status_traduzido;
//   data_vencimento, data_competencia, data_criacao (ISO);
//   categorias: [{id, nome}]; centros_de_custo: [{id, nome}].
function normalizarLancamento(l, ehCredito, regime = 'caixa') {
  // Regime caixa = o que foi efetivamente pago/recebido; competência = total.
  const valor = Number(regime === 'competencia' ? (l.total ?? 0) : (l.pago ?? 0));

  return {
    data: l.data_competencia ?? l.data_vencimento ?? l.data_criacao ?? null,
    descricao: l.descricao ?? l.description ?? '',
    categoria: l.categorias?.[0]?.nome ?? l.categoria?.nome ?? l.categoria ?? '',
    // centros de custo: array {nome}; com mais de um, o rateio divide o valor.
    centrosCusto: extrairCentrosCusto(l),
    valor: Math.abs(valor),
    credito: ehCredito,
    situacao: l.status_traduzido ?? l.status ?? '',
  };
}

// Extrai a lista de centros de custo de um lançamento, lidando com rateio.
// Formato real: centros_de_custo: [{id, nome}].
function extrairCentrosCusto(l) {
  const cc = l.centros_de_custo ?? l.centros_custo ?? l.centrosCusto ?? l.centro_custo ?? l.costCenters;
  if (Array.isArray(cc)) {
    return cc.map(x => (typeof x === 'string' ? x : (x.nome ?? x.name ?? ''))).filter(Boolean);
  }
  if (typeof cc === 'string' && cc) return [cc];
  return []; // sem centro de custo
}

// ---------------------------------------------------------------------------
// Aplica rateio: um lançamento com N centros de custo vira N linhas, cada uma
// com valor / N. Lançamento sem centro de custo é atribuído à sede (Igreja).
// ---------------------------------------------------------------------------
function aplicarRateio(lancamentos) {
  const linhas = [];
  for (const l of lancamentos) {
    const ccs = l.centrosCusto.length ? l.centrosCusto : [''];
    const fatia = l.valor / ccs.length;
    for (const cc of ccs) {
      linhas.push({
        ...l,
        valor: fatia,
        unidade: unidadeDoCentroCusto(cc),
      });
    }
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// DRE — monta sintética e analítica de uma vez.
// ---------------------------------------------------------------------------
export function montarDRE(lancamentos) {
  const linhas = aplicarRateio(lancamentos);

  // Acumuladores
  const receitasPorGrupo = {};   // grupo -> { total, categorias: {cat: valor}, tipo }
  const deducoes = { total: 0, categorias: {} };
  const despesasPorGrupo = {};   // grupo -> { total, categorias: {cat: valor} }
  const memoria = { transferencias: 0, emprestimos: 0, movimentoCaixa: 0 };

  for (const l of linhas) {
    const catNorm = norm(l.categoria);

    // Fora da DRE — movimentações financeiras
    if (foraDaDRE(l.categoria)) {
      if (catNorm.includes('transferencia')) memoria.transferencias += l.valor;
      else if (catNorm.includes('emprestimo')) memoria.emprestimos += l.valor;
      else if (catNorm.includes('movimento')) memoria.movimentoCaixa += l.valor;
      continue;
    }

    if (l.credito) {
      // Receita — pode ser dedução negativa (taxa de cartão lançada como crédito? não)
      const g = grupoDaReceita(l.categoria);
      if (g) {
        if (!receitasPorGrupo[g.grupo]) {
          receitasPorGrupo[g.grupo] = { total: 0, categorias: {}, tipo: g.tipo };
        }
        receitasPorGrupo[g.grupo].total += l.valor;
        receitasPorGrupo[g.grupo].categorias[l.categoria] =
          (receitasPorGrupo[g.grupo].categorias[l.categoria] || 0) + l.valor;
      } else {
        // receita não mapeada → cai em "Receitas das unidades" como genérica
        const fallback = 'Receitas das unidades';
        if (!receitasPorGrupo[fallback]) {
          receitasPorGrupo[fallback] = { total: 0, categorias: {}, tipo: 'operacional' };
        }
        receitasPorGrupo[fallback].total += l.valor;
        receitasPorGrupo[fallback].categorias[l.categoria] =
          (receitasPorGrupo[fallback].categorias[l.categoria] || 0) + l.valor;
      }
    } else {
      // Débito — dedução ou despesa
      if (ehDeducao(l.categoria)) {
        deducoes.total += l.valor;
        deducoes.categorias[l.categoria] = (deducoes.categorias[l.categoria] || 0) + l.valor;
      } else {
        const grupo = grupoDaDespesa(l.categoria);
        if (!despesasPorGrupo[grupo]) despesasPorGrupo[grupo] = { total: 0, categorias: {} };
        despesasPorGrupo[grupo].total += l.valor;
        despesasPorGrupo[grupo].categorias[l.categoria] =
          (despesasPorGrupo[grupo].categorias[l.categoria] || 0) + l.valor;
      }
    }
  }

  // Subtotais
  const receitaOperacionalBruta = Object.values(receitasPorGrupo)
    .filter(g => g.tipo === 'operacional')
    .reduce((s, g) => s + g.total, 0);
  const receitaNaoOperacional = Object.values(receitasPorGrupo)
    .filter(g => g.tipo === 'nao_operacional')
    .reduce((s, g) => s + g.total, 0);
  const receitaLiquida = receitaOperacionalBruta - deducoes.total;
  const despesaTotal = Object.values(despesasPorGrupo).reduce((s, g) => s + g.total, 0);
  const resultadoOperacional = receitaLiquida - despesaTotal;
  const resultadoLiquido = resultadoOperacional + receitaNaoOperacional;

  return {
    receitasPorGrupo,
    deducoes,
    despesasPorGrupo,
    memoria,
    subtotais: {
      receitaOperacionalBruta,
      deducoes: deducoes.total,
      receitaLiquida,
      despesaTotal,
      resultadoOperacional,
      receitaNaoOperacional,
      resultadoLiquido,
    },
  };
}

// ---------------------------------------------------------------------------
// Resultado por unidade — receita, despesa e resultado de cada centro de custo.
// ---------------------------------------------------------------------------
export function montarUnidades(lancamentos) {
  const linhas = aplicarRateio(lancamentos);
  const mapa = {};
  for (const u of UNIDADES) mapa[u.nome] = { receita: 0, despesa: 0 };

  for (const l of linhas) {
    if (foraDaDRE(l.categoria)) continue;
    const nome = l.unidade;
    if (!mapa[nome]) mapa[nome] = { receita: 0, despesa: 0 };
    if (l.credito) mapa[nome].receita += l.valor;
    else mapa[nome].despesa += l.valor;
  }

  return Object.entries(mapa)
    .map(([nome, v]) => ({ nome, ...v, resultado: v.receita - v.despesa }))
    .filter(u => u.receita !== 0 || u.despesa !== 0)
    .sort((a, b) => b.resultado - a.resultado);
}

// ---------------------------------------------------------------------------
// Receitas e despesas por categoria (para a aba detalhada).
// ---------------------------------------------------------------------------
export function montarReceitasDespesas(lancamentos) {
  const linhas = aplicarRateio(lancamentos);
  const receitas = {};
  const despesas = {};
  for (const l of linhas) {
    if (foraDaDRE(l.categoria)) continue;
    const alvo = l.credito ? receitas : despesas;
    alvo[l.categoria] = (alvo[l.categoria] || 0) + l.valor;
  }
  const ordenar = obj => Object.entries(obj)
    .map(([categoria, valor]) => ({ categoria, valor }))
    .sort((a, b) => b.valor - a.valor);
  return { receitas: ordenar(receitas), despesas: ordenar(despesas) };
}

// ---------------------------------------------------------------------------
// Totais simples (cards da visão geral). Aqui é o BRUTO de caixa — entradas e
// saídas totais, incluindo transferências/movimentações — para bater com os
// totais "recebido/pago" do Conta Azul. A DRE (montarDRE) é que exclui essas
// movimentações do resultado operacional.
// ---------------------------------------------------------------------------
export function montarTotais(lancamentos) {
  const linhas = aplicarRateio(lancamentos);
  let entradas = 0, saidas = 0;
  for (const l of linhas) {
    if (l.credito) entradas += l.valor; else saidas += l.valor;
  }
  return { entradas, saidas, resultado: entradas - saidas };
}
