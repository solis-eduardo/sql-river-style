-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: ON sem parênteses no fonte (AND vira marker solto) é reincorporado e
-- quebrado igual
    SELECT a.id
      FROM tabela_a a
INNER JOIN tabela_b b
        ON ( a.x = b.x
         AND a.y = b.y )
     WHERE a.ativo = TRUE
