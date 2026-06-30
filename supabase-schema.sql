-- supabase-schema.sql
-- Estrutura do banco do painel da Igreja A Ponte.
-- Rode este script no SQL Editor do Supabase (uma vez).

-- 1. Tokens da Conta Azul (1 linha por conta conectada).
create table if not exists ca_tokens (
  account_key   text primary key,
  access_token  text not null,
  refresh_token text,
  expires_at    bigint not null,        -- epoch em ms
  updated_at    timestamptz default now()
);

-- 2. Metas que o cliente digita (orçamento, campanha, salários).
--    chave = nome da categoria/campanha/pessoa; valor = meta em R$.
create table if not exists metas (
  id          bigint generated always as identity primary key,
  account_key text not null,
  tipo        text not null,            -- 'orcamento' | 'campanha' | 'salario'
  chave       text not null,            -- ex.: 'Aluguel', 'Campanha 2026', 'Yohan'
  valor       numeric not null default 0,
  ano         int not null,
  updated_at  timestamptz default now(),
  unique (account_key, tipo, chave, ano)
);

-- 3. (Opcional) índice para leitura rápida por tipo/ano.
create index if not exists idx_metas_lookup on metas (account_key, tipo, ano);

-- Segurança: as tabelas são acessadas só pelo backend com a service role key,
-- então RLS pode ficar habilitado sem políticas públicas. O login dos usuários
-- do painel usa o Supabase Auth nativo (auth.users), gerenciado pelo próprio
-- Supabase — não precisa de tabela extra aqui.
alter table ca_tokens enable row level security;
alter table metas enable row level security;
