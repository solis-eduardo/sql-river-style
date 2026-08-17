-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: subquery em FROM formatada recursivamente com indentação própria
    SELECT id
      FROM (
        SELECT tabela.id
          FROM tabela
         WHERE tabela.ativo = TRUE
           ) sub
     WHERE sub.id > 0
