-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CASE WHEN/THEN em blocos, um por linha, e END alinhado com o CASE
    SELECT a.id
      FROM tabela a
     WHERE a.status <> 42
       AND CASE WHEN x = ''
                THEN TRUE
                WHEN x = 'a' -- Arquivados
                THEN a.status_id = 41
                WHEN x = 't'
                THEN b.is_closed IS TRUE
                 AND a.status_id NOT IN (1, 2)
           END
