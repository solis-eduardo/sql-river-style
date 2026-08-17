-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UPDATE ... SET (lista) ... WHERE com river próprio
update ecm_conteudo set nome = 'novo nome', ativo = true where ecm_conteudo.id = 1 and ecm_conteudo.categoria_id = 2
