-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: INSERT INTO ... SELECT compartilha o mesmo river do INSERT INTO
insert into ecm_conteudo (nome, categoria_id) select origem.nome, origem.categoria_id from origem where origem.ativo = true
