-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: INSERT INTO ... VALUES com múltiplas tuplas + RETURNING, espaço
-- antes da lista de colunas
    INSERT INTO ecm_conteudo (nome, categoria_id)
         VALUES ('a', 1),
                ('b', 2)
      RETURNING id
