-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CTEs encadeadas sem indentação + AS maiúsculo só no cabeçalho da CTE
-- + cast maiúsculo
WITH primeira_cte AS (
    SELECT a.id,
           a.valor::NUMERIC
      FROM tabela_a a
), segunda_cte AS (
    SELECT b.id
      FROM tabela_b b
)

    SELECT primeira_cte.id,
           segunda_cte.id
      FROM primeira_cte
INNER JOIN segunda_cte
        ON ( primeira_cte.id = segunda_cte.id )
