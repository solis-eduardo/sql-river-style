-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CASE dentro de item de SELECT (não só em condição) também quebra em
-- blocos
select case when a.status = 1 then 'ativo' else 'inativo' end as status_desc, a.id from tabela a
