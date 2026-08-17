-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: subquery em FROM formatada recursivamente com indentação própria
select id from (select tabela.id from tabela where tabela.ativo = true) sub where sub.id > 0
