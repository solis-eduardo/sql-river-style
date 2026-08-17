-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CTEs encadeadas sem indentação + AS maiúsculo só no cabeçalho da CTE
-- + cast maiúsculo
with primeira_cte as (
        select a.id, a.valor::numeric from tabela_a a
    ), segunda_cte as (
        select b.id from tabela_b b
    )
    select primeira_cte.id, segunda_cte.id from primeira_cte inner join segunda_cte on primeira_cte.id = segunda_cte.id
