-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: DELETE ... USING (tabela, sem parênteses) ... RETURNING
delete from ecm_conteudo using ecm_categoria where ecm_conteudo.categoria_id = ecm_categoria.id and ecm_categoria.ativo = false returning ecm_conteudo.id
