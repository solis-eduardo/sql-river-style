-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: DELETE FROM / WHERE como duas cláusulas río separadas, igual
-- SELECT/FROM
    DELETE
      FROM ecm_conteudo
     WHERE ecm_conteudo.id = 1
