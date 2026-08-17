-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CASE dentro de item de SELECT (não só em condição) também quebra em
-- blocos
    SELECT CASE WHEN a.status = 1
                THEN 'ativo'
                ELSE 'inativo'
           END as status_desc,
           a.id
      FROM tabela a
