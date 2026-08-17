-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UNION ALL com linha em branco antes/depois + BETWEEN...AND não
-- quebra linha
    SELECT a.id
      FROM tabela_a a
     WHERE a.total BETWEEN 1 AND 10

 UNION ALL

    SELECT b.id
      FROM tabela_b b
