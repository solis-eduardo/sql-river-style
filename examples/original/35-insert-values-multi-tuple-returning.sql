-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: INSERT INTO ... VALUES com múltiplas tuplas + RETURNING, espaço
-- antes da lista de colunas
insert into ecm_conteudo (nome, categoria_id) values ('a', 1), ('b', 2) returning id
