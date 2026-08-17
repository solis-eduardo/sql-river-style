-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CURRENT_TIMESTAMP e afins saem maiúsculos mesmo sem parênteses e
-- mesmo digitados em minúsculo
select a.id from tabela a where a.criado_em <= current_timestamp
