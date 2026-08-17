-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: additionalFunctions maiusculiza função de negócio configurada
    SELECT FN_CALCULA_TOTAL(t.id) as total
      FROM tabela t
