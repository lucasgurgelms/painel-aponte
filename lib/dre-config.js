// lib/dre-config.js
// CONFIGURAÇÃO CENTRAL DA DRE E DAS UNIDADES.
// Este é o único arquivo que precisa de ajuste quando confirmarmos os nomes
// reais das categorias e centros de custo vindos da API deste cliente.
// Baseado na planilha DEMONSTRATIVO_DE_RESULTADOS (Igreja A Ponte).

// ---------------------------------------------------------------------------
// 1. GRUPOS DA DRE (visão sintética) e quais categorias do Conta Azul caem
//    em cada grupo (visão analítica). Os nomes em minúsculo são normalizados
//    (sem acento, lowercase) para casar com o que vem da API, evitando
//    diferenças de grafia.
// ---------------------------------------------------------------------------

// Normaliza um texto: minúsculo, sem acento, sem espaços nas pontas.
export function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// RECEITAS
export const RECEITA_GRUPOS = [
  {
    grupo: 'Dízimos e ofertas',
    tipo: 'operacional',
    categorias: ['dizimos e ofertas'],
  },
  {
    grupo: 'Receitas das unidades',
    tipo: 'operacional',
    // "Receitas Gerais" é a categoria genérica; a separação por unidade vem do
    // centro de custo, tratada no motor. Aqui agrupamos a categoria.
    categorias: ['receitas gerais'],
  },
  {
    grupo: 'Arrecadações',
    tipo: 'operacional',
    // campanha / portal / pontezinha são identificados por centro de custo,
    // mas mantemos categorias específicas se existirem.
    categorias: ['arrecadacoes', 'campanha', 'portal'],
  },
  {
    grupo: 'Rendimentos de aplicações',
    tipo: 'nao_operacional', // entra no resultado, mas separado do operacional
    categorias: ['rendimentos de aplicacoes', 'rendimentos'],
  },
];

// DEDUÇÕES (reduzem a receita bruta)
export const DEDUCAO_CATEGORIAS = ['taxas de cartoes', 'taxas de cartao'];

// DESPESAS — agrupamento operacional
export const DESPESA_GRUPOS = [
  {
    grupo: 'Pessoal',
    categorias: [
      'salarios', 'inss sobre salarios - gps', 'inss', 'irrf s/ salarios - darf 0561',
      'irrf', 'ajuda de custo', 'auxilio refeicao', 'convenio medico',
      'cursos e treinamentos', '13o salario - provisao', 'abono ferias - provisao',
      'plano de saude colaboradores', 'bonificacao - provisao 13o', 'bonificacao',
    ],
  },
  {
    grupo: 'Ocupação',
    categorias: [
      'aluguel', 'energia eletrica', 'agua e saneamento', 'iptu', 'taxa do lixo',
      'manutencao predial', 'manutencao de equipamentos', 'manutencao veiculos',
      'manutencao de veiculos', 'seguros de veiculos',
      'vigilancia e seguranca patrimonial', 'vigilancia', 'estacionamento',
      'outras imobilizacoes por aquisicao', 'outras imobilizacoes', 'combustiveis', 'combustivel',
    ],
  },
  {
    grupo: 'Serviços de terceiros',
    categorias: [
      'servicos prestados', 'servicos de terceiros', 'servicos prestados - terceiros',
      'honorarios contabeis', 'software / licenca de uso', 'software', 'comunicacao',
      'telefonia e internet', 'cartorio', 'transporte urbano (taxi, uber)', 'transporte',
      'frete', 'doacao compaixao',
    ],
  },
  {
    grupo: 'Materiais e revenda',
    categorias: ['materiais para revenda'],
  },
  {
    grupo: 'Administrativas',
    categorias: [
      'despesas gerais', 'materiais de escritorio', 'materiais de limpeza e de higiene',
      'materiais de limpeza', 'copa e cozinha', 'tarifas bancarias', 'impostos',
    ],
  },
  {
    grupo: 'Outras despesas',
    categorias: [
      'lanches e refeicoes', 'viagens e representacoes', 'confraternizacoes',
      'despesas eventuais',
    ],
  },
];

// ---------------------------------------------------------------------------
// 2. CATEGORIAS QUE NÃO ENTRAM NA DRE (movimentações financeiras).
//    Vão para a aba "Movimentações" e ficam fora do resultado.
// ---------------------------------------------------------------------------
export const FORA_DA_DRE = [
  'transferencia de entrada', 'transferencia de saida', 'transferencia',
  'movimento de caixa', 'emprestimos', 'emprestimos recebidos', 'emprestimos efetuados',
];

// ---------------------------------------------------------------------------
// 3. UNIDADES / CENTROS DE CUSTO (para a aba Unidades e o resultado por unidade)
//    Nome de exibição → variações que podem vir da API.
// ---------------------------------------------------------------------------
export const UNIDADES = [
  { nome: 'Igreja', match: ['igreja', '0', ''] }, // sem centro de custo = igreja (sede)
  { nome: 'Ponte Café', match: ['ponte cafe'] },
  { nome: 'Ponte Shop', match: ['ponte shop'] },
  { nome: 'Celebrando Rest.', match: ['celebrando restauracao', 'celebrando rest'] },
  { nome: 'Eventos', match: ['eventos'] },
  { nome: 'Pontezinha', match: ['pontezinha'] },
  { nome: 'Campanha', match: ['campanha'] },
  { nome: 'Portal', match: ['portal'] },
  { nome: 'Produção - Cultos', match: ['producao - cultos', 'producao cultos'] },
  { nome: 'Produção Equipamentos', match: ['producao equipamentos'] },
];

// Helper: dado um nome de categoria (cru da API), retorna o grupo de despesa.
export function grupoDaDespesa(categoriaCrua) {
  const c = norm(categoriaCrua);
  for (const g of DESPESA_GRUPOS) {
    if (g.categorias.includes(c)) return g.grupo;
  }
  return 'Outras despesas'; // fallback — categoria não mapeada cai aqui
}

// Helper: retorna o grupo de receita (ou null se não for receita conhecida).
export function grupoDaReceita(categoriaCrua) {
  const c = norm(categoriaCrua);
  for (const g of RECEITA_GRUPOS) {
    if (g.categorias.includes(c)) return g;
  }
  return null;
}

// Helper: a categoria está fora da DRE (movimentação financeira)?
export function foraDaDRE(categoriaCrua) {
  return FORA_DA_DRE.includes(norm(categoriaCrua));
}

// Helper: é dedução (taxa de cartão)?
export function ehDeducao(categoriaCrua) {
  return DEDUCAO_CATEGORIAS.includes(norm(categoriaCrua));
}

// Helper: resolve o nome de exibição da unidade a partir do centro de custo cru.
export function unidadeDoCentroCusto(centroCustoCru) {
  const c = norm(centroCustoCru);
  for (const u of UNIDADES) {
    if (u.match.includes(c)) return u.nome;
  }
  return centroCustoCru || 'Igreja'; // sem c.custo → sede
}
