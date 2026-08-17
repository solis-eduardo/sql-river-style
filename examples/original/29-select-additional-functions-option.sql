-- sql-river-style-options: additionalFunctions=fn_calcula_total
-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: additionalFunctions maiusculiza função de negócio configurada
select fn_calcula_total(t.id) as total from tabela t
