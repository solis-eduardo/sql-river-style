-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: river style básico + uma coluna por linha + sem ; final
    SELECT tabela.coluna1,
           tabela.coluna2
      FROM tabela
     WHERE tabela.coluna1 = 1
       AND tabela.coluna2 = 2
  ORDER BY tabela.coluna1
