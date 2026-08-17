-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UNION ALL com linha em branco antes/depois + BETWEEN...AND não
-- quebra linha
select a.id from tabela_a a where a.total between 1 and 10
       union all
       select b.id from tabela_b b
