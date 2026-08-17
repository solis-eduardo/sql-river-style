-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UPDATE ... SET (lista) ... WHERE com river próprio
    UPDATE ecm_conteudo
       SET nome = 'novo nome',
           ativo = TRUE
     WHERE ecm_conteudo.id = 1
       AND ecm_conteudo.categoria_id = 2
