-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: ON com múltiplas condições (parênteses já no fonte) quebra uma por
-- linha, alinhada sob a primeira
    SELECT a.id
      FROM tabela_a a
INNER JOIN tabela_b b
        ON ( a.x = b.x
         AND a.y = b.y )
