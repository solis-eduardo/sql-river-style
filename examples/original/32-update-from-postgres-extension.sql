-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UPDATE ... FROM (extensão Postgres) reaproveita marker de FROM
update ecm_conteudo set nome = origem.nome from origem where ecm_conteudo.id = origem.id
