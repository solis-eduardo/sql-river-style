-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: DELETE ... USING (tabela, sem parênteses) ... RETURNING
    DELETE
      FROM ecm_conteudo
     USING ecm_categoria
     WHERE ecm_conteudo.categoria_id = ecm_categoria.id
       AND ecm_categoria.ativo = FALSE
 RETURNING ecm_conteudo.id
